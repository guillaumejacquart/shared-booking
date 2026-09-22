import { randomBytes } from "node:crypto";

import type { Booking, BookingDetail, Office } from "@/dal/types";
import * as availabilityDal from "@/dal/availability";
import * as bookingsDal from "@/dal/bookings";
import * as membersDal from "@/dal/members";
import * as practitionersDal from "@/dal/practitioners";
import * as roomsDal from "@/dal/rooms";
import * as sessionTypesDal from "@/dal/session-types";
import * as usersDal from "@/dal/users";
import { env, isStripeConfigured } from "@/lib/env";
import {
  type ApplyPaymentInput,
  type BookingResult,
  type CancelInput,
  type CreateBookingInput,
  type RescheduleInput,
  type SlotsInput,
  type ValidateInput,
} from "@/lib/schemas/bookings";
import { dateStrInTz, zonedTimeToUtc } from "@/lib/timezone";
import { generateSlots, type Occupancy, type Slot, type SlotRequest } from "@/lib/slots";
import { bookingMutex } from "@/lib/mutex";
import Stripe from "stripe";
import {
  buildIcs,
  confirmationEmail,
  createMailer,
  patientCancelledEmail,
  paymentReceivedEmail,
  practitionerCancelledEmail,
  rescheduledEmail,
  validationPendingEmail,
  validationRequestEmail,
  type BookingMailModel,
  type SendEmail,
} from "@/lib/email";
import {
  ConflictError,
  DeadlineError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "./errors";

/**
 * Service réservation (logique métier). Appelé par les routes HTTP et le cron.
 * - `now` injectable (tests) ; `sendEmail` injectable (tests capturent l'envoi).
 * - La salle n'est jamais exposée au public (détail interne au cabinet).
 */

export interface Deps {
  now?: Date;
  sendEmail?: SendEmail;
  /** Client Stripe (injecté en tests ; défaut = compte plateforme). */
  stripeClient?: StripeLike;
}

/** Sous-ensemble de l'API Stripe utilisée (checkout uniquement). */
export interface StripeLike {
  checkout: {
    sessions: {
      create(params: Record<string, unknown>): Promise<{ id: string; url: string | null }>;
    };
  };
}

function realStripe(): StripeLike | null {
  if (!isStripeConfigured) return null;
  const stripe = new Stripe(env.STRIPE_SECRET_KEY!);
  return stripe as unknown as StripeLike;
}

/** Durée de tenue du créneau pendant le paiement (puis libération auto). */
const PENDING_TTL_MS = 30 * 60_000;

const MAX_FUTURE_PER_EMAIL = 3;
const MAX_BUFFER_MIN = 480; // garde-fou cohérent avec la marge SQL (±24h);

function tokens() {
  return {
    cancelToken: randomBytes(32).toString("hex"),
    rescheduleToken: randomBytes(32).toString("hex"),
  };
}

function deadline(office: { cancelDeadlineHours: number }, startAt: Date): Date {
  return new Date(startAt.getTime() - office.cancelDeadlineHours * 3_600_000);
}

function manageUrl(officeSlug: string, practitionerSlug: string, token: string): string {
  // URL absolue pour les emails (BETTER_AUTH_URL = origine publique de l'app).
  const base = env.BETTER_AUTH_URL.replace(/\/$/, "");
  return `${base}/p/${practitionerSlug}/gerer?token=${token}&cabinet=${officeSlug}`;
}

/** Modèle d'email commun à partir d'une réservation et de son détail. */
function mailModel(
  b: Pick<Booking, "sessionNameSnapshot" | "startAt" | "cancelToken">,
  detail: BookingDetail,
  start: Date = b.startAt,
): BookingMailModel {
  return {
    practitionerName: detail.practitioner.displayName,
    sessionName: b.sessionNameSnapshot,
    start,
    timeZone: detail.office.timezone,
    officeName: detail.office.name,
    officeAddress: detail.office.address,
    manageUrl: manageUrl(detail.office.slug, detail.practitioner.slug, b.cancelToken),
  };
}

/** Pièce calendrier d'une réservation (uid, libellé, lieu, créneau). */
function bookingIcs(
  b: Pick<Booking, "id" | "sessionNameSnapshot" | "startAt" | "endAt" | "patientEmail">,
  practitionerName: string,
  office: Pick<Office, "name" | "address">,
  times?: { start: Date; end: Date },
) {
  return buildIcs({
    uid: b.id,
    summary: `${b.sessionNameSnapshot} — ${practitionerName}`,
    location: office.address ? `${office.name}, ${office.address}` : office.name,
    start: times?.start ?? b.startAt,
    end: times?.end ?? b.endAt,
    attendeeEmail: b.patientEmail,
  });
}

/** Notifie le praticien qu'une demande attend sa validation (sinon il ne le sait jamais). */
async function notifyValidationRequest(
  send: SendEmail,
  detail: BookingDetail,
  b: Booking,
): Promise<void> {
  const pracEmail = await usersDal.getUserEmail(detail.practitioner.userId);
  if (!pracEmail) return;
  await send(
    validationRequestEmail(pracEmail, {
      ...mailModel(b, detail),
      patientName: `${b.patientFirstName} ${b.patientLastName}`,
    }),
  );
}

// --- Disponibilités ---------------------------------------------------------

export interface PublicSlot {
  startAt: string; // ISO UTC
  endAt: string;
}

/** Occupation d'un RDV, buffer de fin inclus. */
function toOccupancy(b: {
  startAt: Date;
  endAt: Date;
  bufferAfterMinSnapshot: number;
}): Occupancy {
  return {
    start: b.startAt,
    end: new Date(b.endAt.getTime() + b.bufferAfterMinSnapshot * 60_000),
  };
}

function toWindows(
  rules: { weekday: number; startTime: string; endTime: string }[],
): SlotRequest["windows"] {
  return rules.map((r) => ({
    weekday: r.weekday,
    startTime: r.startTime,
    endTime: r.endTime,
  }));
}

function toExceptions(
  rows: {
    date: string;
    kind: string;
    startTime: string | null;
    endTime: string | null;
    fullDay: boolean;
    roomId: string | null;
  }[],
): SlotRequest["exceptions"] {
  return rows.map((e) => ({
    date: e.date,
    kind: e.kind as "off" | "extra",
    startTime: e.startTime ?? undefined,
    endTime: e.endTime ?? undefined,
    fullDay: e.fullDay,
    roomId: e.roomId ?? undefined,
  }));
}

/**
 * Salles attribuables au praticien, par ordre de préférence (`sortOrder`
 * puis nom) : la première libre au créneau est attribuée à la réservation.
 * Allowlist vide = toutes les salles du cabinet.
 */
function allowedRoomIdsFor(
  practitionerId: string,
  rooms: Awaited<ReturnType<typeof roomsDal.listRoomsWithMembers>>,
): string[] {
  return rooms
    .filter((r) => r.practitionerIds.length === 0 || r.practitionerIds.includes(practitionerId))
    .map((r) => r.room)
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map((r) => r.id);
}

/**
 * Charge tout ce qu'il faut pour générer une grille : règles (sans salle),
 * exceptions et occupation (praticien + salles autorisées). Partagé par les
 * disponibilités publiques et le report, pour éviter que les deux vues
 * divergent. Chaque créneau généré porte déjà sa salle attribuée.
 */
async function loadSlotContext(
  practitionerId: string,
  officeId: string,
  from: Date,
  to: Date,
  timezone: string,
  excludeBookingId?: string,
  sessionTypeId?: string,
): Promise<
  Pick<SlotRequest, "windows" | "exceptions" | "practitionerBusy" | "roomBusy" | "allowedRoomIds" | "sessionRoomIds">
> {
  const [rules, exceptions, bookings, roomsWithMembers, sessionRoomIds] = await Promise.all([
    availabilityDal.listRules(practitionerId),
    availabilityDal.listExceptions(
      practitionerId,
      dateStrInTz(from, timezone),
      dateStrInTz(to, timezone),
    ),
    bookingsDal.listActiveBookings({
      practitionerId,
      from,
      to,
      excludeBookingId,
    }),
    roomsDal.listRoomsWithMembers(officeId),
    sessionTypeId ? sessionTypesDal.listCompatibleRoomIds(sessionTypeId) : Promise.resolve([] as string[]),
  ]);
  const allowedRoomIds = allowedRoomIdsFor(practitionerId, roomsWithMembers);
  // Surveiller aussi les salles épinglées par les extras (hors autorisées).
  const extraRoomIds = exceptions
    .filter((e) => e.kind === "extra" && e.roomId)
    .map((e) => e.roomId as string);
  const watchIds = [...new Set([...allowedRoomIds, ...extraRoomIds])];
  const roomBookings =
    watchIds.length > 0
      ? await bookingsDal.listActiveBookings({ roomIds: watchIds, from, to, excludeBookingId })
      : [];
  const roomBusy: Record<string, Occupancy[]> = {};
  for (const b of roomBookings) {
    (roomBusy[b.roomId] ??= []).push(toOccupancy(b));
  }
  return {
    windows: toWindows(rules),
    exceptions: toExceptions(exceptions),
    practitionerBusy: bookings.map(toOccupancy),
    roomBusy,
    allowedRoomIds,
    sessionRoomIds,
  };
}

/** Grille interne : chaque créneau porte sa salle attribuée. */
async function getSlotsWithRoom(deps: Deps, input: SlotsInput): Promise<Slot[]> {
  const now = deps.now ?? new Date();

  const page = await practitionersDal.getPractitionerPage(input.practitionerSlug);
  if (!page) throw new NotFoundError("Praticien introuvable");
  const st = page.sessionTypes.find((t) => t.id === input.sessionTypeId);
  if (!st) throw new NotFoundError("Type de séance introuvable");

  const tz = page.office.timezone;
  const dayStart = zonedTimeToUtc(input.fromDate, "00:00", tz);
  const engineFrom = now.getTime() < dayStart.getTime() ? dayStart : now;
  const horizonEnd = new Date(engineFrom.getTime() + input.days * 86_400_000);

  const context = await loadSlotContext(
    page.practitioner.id,
    page.office.id,
    engineFrom,
    horizonEnd,
    tz,
    undefined,
    st.id,
  );
  return generateSlots({
    timezone: tz,
    ...context,
    sessionDurationMin: st.durationMin,
    bufferAfterMin: st.bufferAfterMin,
    leadTimeMin: page.office.bookingLeadTimeMin,
    from: engineFrom,
    days: input.days,
  });
}

export async function getAvailableSlots(deps: Deps, input: SlotsInput): Promise<PublicSlot[]> {
  const slots = await getSlotsWithRoom(deps, input);
  return slots.map((s) => ({
    startAt: s.start.toISOString(),
    endAt: s.end.toISOString(),
  }));
}

// --- Création ---------------------------------------------------------------

export async function createBooking(deps: Deps, input: CreateBookingInput): Promise<BookingResult> {
  const now = deps.now ?? new Date();
  const send = deps.sendEmail ?? createMailer();

  const page = await practitionersDal.getPractitionerPage(input.practitionerSlug);
  if (!page) throw new NotFoundError("Praticien introuvable");
  const st = page.sessionTypes.find((t) => t.id === input.sessionTypeId);
  if (!st) throw new NotFoundError("Type de séance introuvable");
  if (st.bufferAfterMin > MAX_BUFFER_MIN) {
    throw new ValidationError("Configuration de séance invalide");
  }

  const start = new Date(input.startAt);
  if (Number.isNaN(start.getTime())) throw new ValidationError("Horaire invalide");
  if (start.getTime() < now.getTime() + page.office.bookingLeadTimeMin * 60_000) {
    throw new ValidationError("Ce créneau n'est plus réservable");
  }

  // Vérification + insertion sous mutex : sérialise les écritures concurrentes
  // (mono-processus, voir bookingsDal.tryInsertBooking). Distingue hors-grille (400)
  // de pris (409) via la grille sans occupation.
  const email = input.patientEmail.toLowerCase();
  const { cancelToken, rescheduleToken } = tokens();
  const needsPayment = st.requiresPayment;
  const needsValidation = st.requiresValidation;
  if (needsPayment && (!st.priceCents || st.priceCents <= 0)) {
    throw new ValidationError("Séance mal configurée : prix manquant");
  }
  const stripe = needsPayment ? (deps.stripeClient ?? realStripe()) : null;
  if (needsPayment && !stripe) {
    throw new ValidationError("Paiement en ligne indisponible pour le moment");
  }

  const bookingId = crypto.randomUUID();
  let stripeSessionId: string | null = null;
  let checkoutUrl: string | undefined;
  if (needsPayment) {
    const base = env.BETTER_AUTH_URL.replace(/\/$/, "");
    const session = await stripe!.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: st.currency ?? "eur",
            unit_amount: st.priceCents!,
            product_data: { name: `${st.name} — ${page.practitioner.displayName}` },
          },
          quantity: 1,
        },
      ],
      metadata: { bookingId },
      expires_at: Math.floor((now.getTime() + PENDING_TTL_MS) / 1000),
      success_url: `${base}/p/${page.practitioner.slug}/merci?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/p/${page.practitioner.slug}?paiement=annule`,
    });
    if (!session.url) throw new ValidationError("Paiement en ligne indisponible pour le moment");
    stripeSessionId = session.id;
    checkoutUrl = session.url;
  }

  const booked = await bookingMutex.run(async () => {
    const dateStr = dateStrInTz(start, page.office.timezone);
    const slot = (
      await getSlotsWithRoom(deps, {
        practitionerSlug: input.practitionerSlug,
        sessionTypeId: input.sessionTypeId,
        fromDate: dateStr,
        days: 1,
      })
    ).find((s) => s.start.toISOString() === start.toISOString());
    if (!slot) {
      // Distingue hors-grille (400) de pris (409) via la grille sans occupation.
      const onGrid = await slotOnGrid(
        page.practitioner.id,
        page.office.id,
        st.id,
        st.durationMin,
        st.bufferAfterMin,
        start,
        page.office.timezone,
      );
      if (!onGrid) throw new ValidationError("Créneau invalide");
      throw new ConflictError("Créneau déjà réservé");
    }

    const futureCount = await bookingsDal.countFutureConfirmedByEmail(page.practitioner.id,
      email,
      now);
    if (futureCount >= MAX_FUTURE_PER_EMAIL) {
      throw new ValidationError("Trop de réservations à venir avec cet email");
    }

    const inserted = await bookingsDal.tryInsertBooking({
      id: bookingId,
      officeId: page.office.id,
      practitionerId: page.practitioner.id,
      roomId: slot.roomId,
      sessionTypeId: st.id,
      sessionNameSnapshot: st.name,
      durationMinSnapshot: st.durationMin,
      bufferAfterMinSnapshot: st.bufferAfterMin,
      startAt: start,
      endAt: slot.end,
      patientFirstName: input.patientFirstName,
      patientLastName: input.patientLastName,
      patientEmail: email,
      patientPhone: input.patientPhone,
      notes: input.notes,
      cancelToken,
      rescheduleToken,
      status: needsPayment || needsValidation ? "pending" : "confirmed",
      paymentStatus: needsPayment ? "pending" : "none",
      stripeSessionId,
      validationRequired: needsValidation,
      pendingExpiresAt: needsPayment ? new Date(now.getTime() + PENDING_TTL_MS) : null,
    });
    if (inserted.conflict) throw new ConflictError("Créneau déjà réservé");
    return { id: inserted.id, endAt: slot.end.toISOString() };
  });
  const end = new Date(booked.endAt);
  const status = needsPayment || needsValidation ? "pending" : "confirmed";

  const model = {
    practitionerName: page.practitioner.displayName,
    sessionName: st.name,
    start,
    timeZone: page.office.timezone,
    officeName: page.office.name,
    officeAddress: page.office.address,
    manageUrl: manageUrl(page.office.slug, page.practitioner.slug, cancelToken),
  };
  const ics = bookingIcs(
    {
      id: booked.id,
      sessionNameSnapshot: st.name,
      startAt: start,
      endAt: end,
      patientEmail: email,
    },
    page.practitioner.displayName,
    page.office,
  );
  if (status === "confirmed") {
    // Flux classique : confirmation immédiate.
    await send(confirmationEmail(email, model, ics));
  } else if (!needsPayment) {
    // Validation praticien sans paiement : accusé de réception patient...
    // ...et notification au praticien (sinon il ne sait pas qu'il doit agir).
    await send(validationPendingEmail(email, model));
    const pracEmail = await usersDal.getUserEmail(page.practitioner.userId);
    if (pracEmail) {
      await send(
        validationRequestEmail(pracEmail, {
          ...model,
          patientName: `${input.patientFirstName} ${input.patientLastName}`,
        }),
      );
    }
  }
  // Cas payant : aucun email avant le paiement (le webhook confirme).

  return {
    id: booked.id,
    status,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    cancelToken,
    rescheduleToken,
    requiresPayment: needsPayment,
    ...(checkoutUrl ? { checkoutUrl } : {}),
  };
}

// --- Paiement ----------------------------------------------------------------

/**
 * Webhook Stripe `checkout.session.completed` : marque payé puis confirme
 * si aucune validation praticien n'est requise. Idempotent (retries Stripe).
 */
export async function applyPaymentCompleted(
  deps: Deps,
  input: ApplyPaymentInput,
): Promise<{ applied: boolean; confirmed: boolean }> {
  const send = deps.sendEmail ?? createMailer();

  const detail = await bookingsDal.findBookingByStripeSession(input.stripeSessionId);
  if (!detail) return { applied: false, confirmed: false };
  const { booking: b } = detail;
  if (b.paymentStatus === "paid") return { applied: false, confirmed: false };
  if (b.status !== "pending") return { applied: false, confirmed: false };

  await bookingsDal.markBookingPaid(b.id, input.paymentIntentId);
  const confirmed = await finalizeBookingIfReady({ ...deps, sendEmail: send }, b.id);
  return { applied: true, confirmed };
}

/**
 * Bascule un `pending` en `confirmed` quand tout est réuni (payé si requis,
 * validé si requis) + email de confirmation. Utilisé par le webhook et,
 * plus tard, par la validation praticien.
 */
export async function finalizeBookingIfReady(
  deps: Deps,
  bookingId: string,
): Promise<boolean> {
  const send = deps.sendEmail ?? createMailer();
  const b = await bookingsDal.getBookingRowById(bookingId);
  if (!b || b.status !== "pending") return false;
  if (b.paymentStatus === "pending") return false;
  if (b.validationRequired && !b.validatedAt) {
    // Payé mais en attente de validation : on prévient le patient.
    if (b.paymentStatus === "paid") {
      const detail = await bookingsDal.findBookingByCancelToken(b.cancelToken);
      if (detail) {
        await send(paymentReceivedEmail(b.patientEmail, mailModel(b, detail)));
        await notifyValidationRequest(send, detail, b);
      }
    }
    return false;
  }
  await bookingsDal.markBookingConfirmed(b.id);
  const detail = await bookingsDal.findBookingByCancelToken(b.cancelToken);
  if (!detail) return true;
  await send(
    confirmationEmail(
      b.patientEmail,
      mailModel(b, detail),
      bookingIcs(b, detail.practitioner.displayName, detail.office),
    ),
  );
  return true;
}

/** Libère les pendings dont le paiement a expiré (cron). */
export async function releaseExpiredPendings(deps: Deps): Promise<number> {
  const now = deps.now ?? new Date();
  const expired = await bookingsDal.listExpiredPendings(now);
  for (const b of expired) {
    await bookingsDal.markBookingCancelled(b.id, "Paiement expiré", now);
  }
  return expired.length;
}

// --- Validation praticien ----------------------------------------------------

/**
 * Valide (confirme) ou refuse une demande en attente de validation.
 * Autorisé : le praticien du RDV ou un owner du cabinet.
 */
export async function validateBooking(
  deps: Deps,
  input: ValidateInput,
): Promise<{ id: string; status: string }> {
  const now = deps.now ?? new Date();
  const send = deps.sendEmail ?? createMailer();

  const detail = await bookingsDal.getBookingById(input.bookingId);
  if (!detail) throw new NotFoundError("Réservation introuvable");
  const { booking: b, practitioner: prac, office } = detail;
  if (b.status !== "pending" || !b.validationRequired || b.validatedAt) {
    throw new ConflictError("Cette réservation n'est plus à valider");
  }
  if (prac.userId !== input.requesterUserId || !prac.active) {
    const m = await membersDal.getMembership(office.id, input.requesterUserId);
    if (!m || m.role !== "owner" || !m.active) {
      throw new ForbiddenError("Seul le praticien ou le responsable peut valider");
    }
  }
  if (b.paymentStatus === "pending") {
    throw new ConflictError("Paiement en attente");
  }

  const model = mailModel(b, detail);
  if (input.accept) {
    await bookingsDal.markBookingValidated(b.id, now);
    await finalizeBookingIfReady({ ...deps, sendEmail: send }, b.id);
    return { id: b.id, status: "confirmed" };
  }
  if (!input.reason) throw new ValidationError("Un motif de refus est requis");
  await bookingsDal.markBookingCancelled(b.id, input.reason, now);
  await send(practitionerCancelledEmail(b.patientEmail, { ...model, reason: input.reason }));
  return { id: b.id, status: "cancelled" };
}

// --- Annulation --------------------------------------------------------------

export async function cancelBooking(
  deps: Deps,
  input: CancelInput,
): Promise<{ id: string; status: string }> {
  const now = deps.now ?? new Date();
  const send = deps.sendEmail ?? createMailer();

  const detail = await bookingsDal.findBookingByCancelToken(input.token);
  if (!detail) throw new NotFoundError("Réservation introuvable");
  const { booking: b, practitioner: prac, office } = detail;
  if (b.status === "cancelled") return { id: b.id, status: b.status };

  if (input.by === "patient") {
    if (now.getTime() > deadline(office, b.startAt).getTime()) {
      throw new DeadlineError(
        "Annulation en ligne impossible : contactez directement le praticien",
      );
    }
  } else if (!input.reason) {
    throw new ValidationError("Un motif d'annulation est requis");
  }

  await bookingsDal.markBookingCancelled(b.id, input.reason ?? null, now);

  // Pas de lien de gestion dans un email d'annulation : `manageUrl` vide.
  const model = { ...mailModel(b, detail), manageUrl: "" };
  if (input.by === "patient") {
    const pracEmail = await usersDal.getUserEmail(prac.userId);
    if (pracEmail) {
      await send(
        patientCancelledEmail(pracEmail, {
          ...model,
          patientName: `${b.patientFirstName} ${b.patientLastName}`,
        }),
      );
    }
  } else {
    await send(
      practitionerCancelledEmail(b.patientEmail, { ...model, reason: input.reason! }),
    );
  }
  return { id: b.id, status: "cancelled" };
}

// --- Report ------------------------------------------------------------------

export async function rescheduleBooking(
  deps: Deps,
  input: RescheduleInput,
): Promise<BookingResult> {
  const now = deps.now ?? new Date();
  const send = deps.sendEmail ?? createMailer();

  const detail = await bookingsDal.findBookingByRescheduleToken(input.token);
  if (!detail) throw new NotFoundError("Réservation introuvable");
  const { booking: b, practitioner: prac, office } = detail;
  if (b.status !== "confirmed") {
    throw new ConflictError("Cette réservation n'est plus modifiable");
  }
  if (now.getTime() > deadline(office, b.startAt).getTime()) {
    throw new DeadlineError(
      "Report en ligne impossible : contactez directement le praticien",
    );
  }

  const newStart = new Date(input.newStartAt);
  if (Number.isNaN(newStart.getTime()) || newStart.getTime() <= now.getTime()) {
    throw new ValidationError("Nouvel horaire invalide");
  }

  // La séance garde son type d'origine (snapshots) : on régénère la grille du
  // jour cible avec durée/buffer d'origine et on vérifie l'alignement.
  // Vérification + déplacement sous mutex (voir createBooking).
  const target = await bookingMutex.run(async () => {
    const tz = office.timezone;
    const dateStr = dateStrInTz(newStart, tz);
    const engineFrom = now;
    const horizonEnd = new Date(newStart.getTime() + 86_400_000);
    const context = await loadSlotContext(prac.id, office.id, engineFrom, horizonEnd, tz, b.id, b.sessionTypeId);
    const allSlots = generateSlots({
      timezone: tz,
      ...context,
      sessionDurationMin: b.durationMinSnapshot,
      bufferAfterMin: b.bufferAfterMinSnapshot,
      leadTimeMin: office.bookingLeadTimeMin,
      from: engineFrom,
      days: Math.max(
        1,
        Math.ceil((horizonEnd.getTime() - engineFrom.getTime()) / 86_400_000),
      ),
    }).filter((s) => dateStrInTz(s.start, tz) === dateStr);

    const found = allSlots.find((s) => s.start.getTime() === newStart.getTime());
    if (!found) throw new ConflictError("Nouveau créneau indisponible");

    const moved = await bookingsDal.tryMoveBooking(b.id, {
      startAt: found.start,
      endAt: found.end,
      roomId: found.roomId,
    });
    if (!moved) throw new ConflictError("Nouveau créneau indisponible");
    return found;
  });

  await send(
    rescheduledEmail(
      b.patientEmail,
      mailModel(b, detail, target.start),
      bookingIcs(b, prac.displayName, office, {
        start: target.start,
        end: target.end,
      }),
    ),
  );

  return {
    id: b.id,
    status: "confirmed",
    startAt: target.start.toISOString(),
    endAt: target.end.toISOString(),
    cancelToken: b.cancelToken,
    rescheduleToken: b.rescheduleToken,
    requiresPayment: false,
  };
}

/**
 * Statut d'une réservation payée, pour la page de retour Stripe.
 * Null si `session_id` inconnu (`session_id` fait office de secret).
 */
export async function getBookingStatusByStripeSession(stripeSessionId: string) {
  const detail = await bookingsDal.findBookingByStripeSession(stripeSessionId);
  if (!detail) return null;
  const { booking: b, practitioner: prac } = detail;
  return {
    status: b.status,
    paymentStatus: b.paymentStatus,
    practitionerSlug: prac.slug,
    sessionName: b.sessionNameSnapshot,
    startAt: b.startAt.toISOString(),
  };
}

// --- Helpers internes --------------------------------------------------------

/**
 * Le créneau existe-t-il dans la grille théorique (sans occupation) ?
 * Sert à distinguer un horaire hors-grille (400) d'un créneau pris (409).
 * La salle attribuée ici n'est qu'indicative : seule compte l'existence.
 */
async function slotOnGrid(
  practitionerId: string,
  officeId: string,
  sessionTypeId: string,
  durationMin: number,
  bufferAfterMin: number,
  start: Date,
  timezone: string,
): Promise<boolean> {
  const [rules, roomsWithMembers, sessionRoomIds] = await Promise.all([
    availabilityDal.listRules(practitionerId),
    roomsDal.listRoomsWithMembers(officeId),
    sessionTypesDal.listCompatibleRoomIds(sessionTypeId),
  ]);
  const slots = generateSlots({
    timezone,
    windows: toWindows(rules),
    exceptions: [],
    practitionerBusy: [],
    roomBusy: {},
    allowedRoomIds: allowedRoomIdsFor(practitionerId, roomsWithMembers),
    sessionRoomIds,
    sessionDurationMin: durationMin,
    bufferAfterMin,
    leadTimeMin: 0,
    from: new Date(start.getTime() - 86_400_000),
    days: 3,
  });
  return slots.some((s) => s.start.getTime() === start.getTime());
}
