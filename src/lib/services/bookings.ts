import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

import type { Db } from "@/dal/types";
import * as store from "@/dal/store";
import { booking } from "@/db/schema";
import { env, isStripeConfigured } from "@/lib/env";
import {
  applyPaymentSchema,
  cancelBookingSchema,
  createBookingSchema,
  rescheduleBookingSchema,
  slotsQuerySchema,
  validateBookingSchema,
  type ApplyPaymentInput,
  type BookingResult,
  type CancelInput,
  type CreateBookingInput,
  type RescheduleInput,
  type SlotsInput,
  type ValidateInput,
} from "@/lib/schemas/bookings";
import { dateStrInTz, zonedTimeToUtc } from "@/lib/timezone";
import { generateSlots } from "@/lib/slots";
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
  type SendEmail,
} from "@/lib/email";
import {
  ConflictError,
  DeadlineError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  validationError,
} from "./errors";

/**
 * Service réservation (logique métier). Appelé par les routes HTTP et le cron.
 * - `now` injectable (tests) ; `sendEmail` injectable (tests capturent l'envoi).
 * - La salle n'est jamais exposée au public (détail interne au cabinet).
 */

export interface Deps {
  db: Db;
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

// --- Disponibilités ---------------------------------------------------------

export interface PublicSlot {
  startAt: string; // ISO UTC
  endAt: string;
}

export async function getAvailableSlots(deps: Deps, input: SlotsInput): Promise<PublicSlot[]> {
  const now = deps.now ?? new Date();

  const page = await store.getPractitionerPage(deps.db, input.practitionerSlug);
  if (!page) throw new NotFoundError("Praticien introuvable");
  const st = page.sessionTypes.find((t) => t.id === input.sessionTypeId);
  if (!st) throw new NotFoundError("Type de séance introuvable");

  const tz = page.office.timezone;
  const dayStart = zonedTimeToUtc(input.fromDate, "00:00", tz);
  const engineFrom = now.getTime() < dayStart.getTime() ? dayStart : now;
  const horizonEnd = new Date(engineFrom.getTime() + input.days * 86_400_000);

  const rules = await store.listRules(deps.db, page.practitioner.id);
  const exceptions = await store.listExceptions(
    deps.db,
    page.practitioner.id,
    dateStrInTz(engineFrom, tz),
    dateStrInTz(horizonEnd, tz),
  );
  const bookings = await store.listActiveBookings(deps.db, {
    practitionerId: page.practitioner.id,
    from: engineFrom,
    to: horizonEnd,
  });
  const roomIds = [...new Set(rules.map((r) => r.roomId))];
  const roomBookings =
    roomIds.length > 0
      ? await store.listActiveBookings(deps.db, {
          roomIds,
          from: engineFrom,
          to: horizonEnd,
        })
      : [];
  const roomBusy: Record<string, { start: Date; end: Date }[]> = {};
  for (const b of roomBookings) {
    const list = roomBusy[b.roomId] ?? [];
    list.push({
      start: b.startAt,
      end: new Date(b.endAt.getTime() + b.bufferAfterMinSnapshot * 60_000),
    });
    roomBusy[b.roomId] = list;
  }

  const slots = generateSlots({
    timezone: tz,
    windows: rules.map((r) => ({
      weekday: r.weekday,
      startTime: r.startTime,
      endTime: r.endTime,
      roomId: r.roomId,
    })),
    exceptions: exceptions.map((e) => ({
      date: e.date,
      kind: e.kind as "off" | "extra",
      startTime: e.startTime ?? undefined,
      endTime: e.endTime ?? undefined,
      fullDay: e.fullDay,
      roomId: e.roomId ?? undefined,
    })),
    practitionerBusy: bookings.map((b) => ({
      start: b.startAt,
      end: new Date(b.endAt.getTime() + b.bufferAfterMinSnapshot * 60_000),
    })),
    roomBusy,
    sessionDurationMin: st.durationMin,
    bufferAfterMin: st.bufferAfterMin,
    leadTimeMin: page.office.bookingLeadTimeMin,
    from: engineFrom,
    days: input.days,
  });

  return slots.map((s) => ({
    startAt: s.start.toISOString(),
    endAt: s.end.toISOString(),
  }));
}

// --- Création ---------------------------------------------------------------

export async function createBooking(deps: Deps, input: CreateBookingInput): Promise<BookingResult> {
  const now = deps.now ?? new Date();
  const send = deps.sendEmail ?? createMailer();

  const page = await store.getPractitionerPage(deps.db, input.practitionerSlug);
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
  // (mono-processus, voir store.tryInsertBooking). Distingue hors-grille (400)
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
    const daySlots = (
      await getAvailableSlots(deps, {
        practitionerSlug: input.practitionerSlug,
        sessionTypeId: input.sessionTypeId,
        fromDate: dateStr,
        days: 1,
      })
    ).filter((s) => s.startAt === start.toISOString());
    if (daySlots.length === 0) {
      await resolveSlotRoom(
        deps,
        page.practitioner.id,
        st.durationMin,
        st.bufferAfterMin,
        start,
        page.office.timezone,
      ).catch(() => {
        throw new ValidationError("Créneau invalide");
      });
      throw new ConflictError("Créneau déjà réservé");
    }
    const slot = daySlots[0];

    const futureCount = await store.countFutureConfirmedByEmail(
      deps.db,
      page.practitioner.id,
      email,
      now,
    );
    if (futureCount >= MAX_FUTURE_PER_EMAIL) {
      throw new ValidationError("Trop de réservations à venir avec cet email");
    }

    const roomId = await resolveSlotRoom(
      deps,
      page.practitioner.id,
      st.durationMin,
      st.bufferAfterMin,
      start,
      page.office.timezone,
    );
    const inserted = await store.tryInsertBooking(deps.db, {
      id: bookingId,
      officeId: page.office.id,
      practitionerId: page.practitioner.id,
      roomId,
      sessionTypeId: st.id,
      sessionNameSnapshot: st.name,
      durationMinSnapshot: st.durationMin,
      bufferAfterMinSnapshot: st.bufferAfterMin,
      startAt: start,
      endAt: new Date(slot.endAt),
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
    return { id: inserted.id, endAt: slot.endAt };
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
  const ics = buildIcs({
    uid: booked.id,
    summary: `${st.name} — ${page.practitioner.displayName}`,
    location: page.office.address
      ? `${page.office.name}, ${page.office.address}`
      : page.office.name,
    start,
    end,
    attendeeEmail: email,
  });
  if (status === "confirmed") {
    // Flux classique : confirmation immédiate.
    await send(confirmationEmail(email, model, ics));
  } else if (!needsPayment) {
    // Validation praticien sans paiement : accusé de réception.
    await send(validationPendingEmail(email, model));
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

  const detail = await store.findBookingByStripeSession(deps.db, input.stripeSessionId);
  if (!detail) return { applied: false, confirmed: false };
  const { booking: b } = detail;
  if (b.paymentStatus === "paid") return { applied: false, confirmed: false };
  if (b.status !== "pending") return { applied: false, confirmed: false };

  await store.markBookingPaid(deps.db, b.id, input.paymentIntentId);
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
  const rows = await deps.db
    .select()
    .from(booking)
    .where(eq(booking.id, bookingId))
    .limit(1);
  const b = rows[0];
  if (!b || b.status !== "pending") return false;
  if (b.paymentStatus === "pending") return false;
  if (b.validationRequired && !b.validatedAt) {
    // Payé mais en attente de validation : on prévient le patient.
    if (b.paymentStatus === "paid") {
      const detail = await store.findBookingByCancelToken(deps.db, b.cancelToken);
      if (detail) {
        await send(
          paymentReceivedEmail(b.patientEmail, {
            practitionerName: detail.practitioner.displayName,
            sessionName: b.sessionNameSnapshot,
            start: b.startAt,
            timeZone: detail.office.timezone,
            officeName: detail.office.name,
            officeAddress: detail.office.address,
            manageUrl: manageUrl(detail.office.slug, detail.practitioner.slug, b.cancelToken),
          }),
        );
      }
    }
    return false;
  }
  await store.markBookingConfirmed(deps.db, b.id);
  const detail = await store.findBookingByCancelToken(deps.db, b.cancelToken);
  if (!detail) return true;
  await send(
    confirmationEmail(
      b.patientEmail,
      {
        practitionerName: detail.practitioner.displayName,
        sessionName: b.sessionNameSnapshot,
        start: b.startAt,
        timeZone: detail.office.timezone,
        officeName: detail.office.name,
        officeAddress: detail.office.address,
        manageUrl: manageUrl(detail.office.slug, detail.practitioner.slug, b.cancelToken),
      },
      buildIcs({
        uid: b.id,
        summary: `${b.sessionNameSnapshot} — ${detail.practitioner.displayName}`,
        location: detail.office.address
          ? `${detail.office.name}, ${detail.office.address}`
          : detail.office.name,
        start: b.startAt,
        end: b.endAt,
        attendeeEmail: b.patientEmail,
      }),
    ),
  );
  return true;
}

/** Libère les pendings dont le paiement a expiré (cron). */
export async function releaseExpiredPendings(deps: Deps): Promise<number> {
  const now = deps.now ?? new Date();
  const expired = await store.listExpiredPendings(deps.db, now);
  for (const b of expired) {
    await store.markBookingCancelled(deps.db, b.id, "Paiement expiré", now);
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

  const detail = await store.getBookingById(deps.db, input.bookingId);
  if (!detail) throw new NotFoundError("Réservation introuvable");
  const { booking: b, practitioner: prac, office } = detail;
  if (b.status !== "pending" || !b.validationRequired || b.validatedAt) {
    throw new ConflictError("Cette réservation n'est plus à valider");
  }
  if (prac.userId !== input.requesterUserId) {
    const m = await store.getMembership(deps.db, office.id, input.requesterUserId);
    if (!m || m.role !== "owner" || !m.active) {
      throw new ForbiddenError("Seul le praticien ou le responsable peut valider");
    }
  }
  if (b.paymentStatus === "pending") {
    throw new ConflictError("Paiement en attente");
  }

  const model = {
    practitionerName: prac.displayName,
    sessionName: b.sessionNameSnapshot,
    start: b.startAt,
    timeZone: office.timezone,
    officeName: office.name,
    officeAddress: office.address,
    manageUrl: manageUrl(office.slug, prac.slug, b.cancelToken),
  };
  if (input.accept) {
    await store.markBookingValidated(deps.db, b.id, now);
    await finalizeBookingIfReady({ ...deps, sendEmail: send }, b.id);
    return { id: b.id, status: "confirmed" };
  }
  if (!input.reason) throw new ValidationError("Un motif de refus est requis");
  await store.markBookingCancelled(deps.db, b.id, input.reason, now);
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

  const detail = await store.findBookingByCancelToken(deps.db, input.token);
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

  await store.markBookingCancelled(deps.db, b.id, input.reason ?? null, now);

  const model = {
    practitionerName: prac.displayName,
    sessionName: b.sessionNameSnapshot,
    start: b.startAt,
    timeZone: office.timezone,
    officeName: office.name,
    officeAddress: office.address,
    manageUrl: "",
  };
  if (input.by === "patient") {
    const pracEmail = await store.getUserEmail(deps.db, prac.userId);
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

  const detail = await store.findBookingByRescheduleToken(deps.db, input.token);
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
    const rules = await store.listRules(deps.db, prac.id);
    const exceptions = await store.listExceptions(
      deps.db,
      prac.id,
      dateStrInTz(engineFrom, tz),
      dateStrInTz(horizonEnd, tz),
    );
    const busy = await store.listActiveBookings(deps.db, {
      practitionerId: prac.id,
      excludeBookingId: b.id,
      from: engineFrom,
      to: horizonEnd,
    });
    const roomIds = [...new Set(rules.map((r) => r.roomId))];
    const roomBusyRows =
      roomIds.length > 0
        ? await store.listActiveBookings(deps.db, {
            roomIds,
            excludeBookingId: b.id,
            from: engineFrom,
            to: horizonEnd,
          })
        : [];
    const roomBusy: Record<string, { start: Date; end: Date }[]> = {};
    for (const rb of roomBusyRows) {
      const list = roomBusy[rb.roomId] ?? [];
      list.push({
        start: rb.startAt,
        end: new Date(rb.endAt.getTime() + rb.bufferAfterMinSnapshot * 60_000),
      });
      roomBusy[rb.roomId] = list;
    }
    const allSlots = generateSlots({
    timezone: tz,
    windows: rules.map((r) => ({
      weekday: r.weekday,
      startTime: r.startTime,
      endTime: r.endTime,
      roomId: r.roomId,
    })),
    exceptions: exceptions.map((e) => ({
      date: e.date,
      kind: e.kind as "off" | "extra",
      startTime: e.startTime ?? undefined,
      endTime: e.endTime ?? undefined,
      fullDay: e.fullDay,
      roomId: e.roomId ?? undefined,
    })),
    practitionerBusy: busy.map((x) => ({
      start: x.startAt,
      end: new Date(x.endAt.getTime() + x.bufferAfterMinSnapshot * 60_000),
    })),
    roomBusy,
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

    const moved = await store.tryMoveBooking(deps.db, b.id, {
      startAt: found.start,
      endAt: found.end,
      roomId: found.roomId,
    });
    if (!moved) throw new ConflictError("Nouveau créneau indisponible");
    return found;
  });
  const tz = office.timezone;

  const model = {
    practitionerName: prac.displayName,
    sessionName: b.sessionNameSnapshot,
    start: target.start,
    timeZone: tz,
    officeName: office.name,
    officeAddress: office.address,
    manageUrl: manageUrl(office.slug, prac.slug, b.cancelToken),
  };
  await send(
    rescheduledEmail(
      b.patientEmail,
      model,
      buildIcs({
        uid: b.id,
        summary: `${b.sessionNameSnapshot} — ${prac.displayName}`,
        location: office.address ? `${office.name}, ${office.address}` : office.name,
        start: target.start,
        end: target.end,
        attendeeEmail: b.patientEmail,
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

// --- Helpers internes ---

// --- Helpers internes --------------------------------------------------------

/**
 * Retrouve la salle du créneau validé : on régénère la grille du jour (sans
 * occupation) et on reprend le roomId du créneau aligné. Le créneau a déjà
 * été validé libre juste avant ; la garde atomique du store couvre la course.
 */
async function resolveSlotRoom(
  deps: Deps,
  practitionerId: string,
  durationMin: number,
  bufferAfterMin: number,
  start: Date,
  timezone: string,
): Promise<string> {
  const rules = await store.listRules(deps.db, practitionerId);
  const slots = generateSlots({
    timezone,
    windows: rules.map((r) => ({
      weekday: r.weekday,
      startTime: r.startTime,
      endTime: r.endTime,
      roomId: r.roomId,
    })),
    exceptions: [],
    practitionerBusy: [],
    roomBusy: {},
    sessionDurationMin: durationMin,
    bufferAfterMin,
    leadTimeMin: 0,
    from: new Date(start.getTime() - 86_400_000),
    days: 3,
  }).filter((s) => s.start.getTime() === start.getTime());
  const found = slots[0];
  if (!found) throw new ConflictError("Créneau déjà réservé");
  return found.roomId;
}
