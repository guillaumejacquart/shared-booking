import * as bookingsDal from "@/dal/bookings";
import * as practitionersDal from "@/dal/practitioners";
import * as usersDal from "@/dal/users";
import {
  confirmationEmail,
  validationPendingEmail,
  validationRequestEmail,
} from "@/lib/email";
import { env } from "@/lib/env";
import type { BookingResult, CreateBookingInput } from "@/lib/schemas/bookings";
import { dateStrInTz } from "@/lib/timezone";
import { bookingMutex } from "@/lib/mutex";
import type { Slot } from "@/lib/slots";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import {
  bookingIcs,
  defaultSend,
  manageUrl,
  MAX_BUFFER_MIN,
  MAX_FUTURE_PER_EMAIL,
  PENDING_TTL_MS,
  realStripe,
  safeSend,
  tokens,
  type Deps,
} from "./shared";
import { getSlotsWithRoom, slotOnGrid } from "./slots";

type PractitionerPage = NonNullable<
  Awaited<ReturnType<typeof practitionersDal.getPractitionerPage>>
>;
type PageSessionType = PractitionerPage["sessionTypes"][number];

/**
 * Résout le créneau demandé dans la grille du jour (avec sa salle).
 * Distingue hors-grille (400) de pris (409) via la grille sans occupation.
 */
async function resolveSlot(
  deps: Deps,
  page: PractitionerPage,
  st: PageSessionType,
  start: Date,
): Promise<Slot> {
  const dateStr = dateStrInTz(start, page.office.timezone);
  const slot = (
    await getSlotsWithRoom(deps, {
      practitionerSlug: page.practitioner.slug,
      sessionTypeId: st.id,
      fromDate: dateStr,
      days: 1,
    })
  ).find((s) => s.start.toISOString() === start.toISOString());
  if (!slot) {
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
  return slot;
}

// --- Création ---------------------------------------------------------------

export async function createBooking(deps: Deps, input: CreateBookingInput): Promise<BookingResult> {
  const now = deps.now ?? new Date();
  const send = deps.sendEmail ?? defaultSend();

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

  // Phase 1 (mutex) : créneau + quota vérifiés AVANT tout appel Stripe
  // (pas de session orpheline si le créneau est pris ou le quota dépassé).
  const checked = await bookingMutex.run(async () => {
    const slot = await resolveSlot(deps, page, st, start);
    const futureCount = await bookingsDal.countFutureConfirmedByEmail(
      page.practitioner.id,
      email,
      now,
    );
    if (futureCount >= MAX_FUTURE_PER_EMAIL) {
      throw new ValidationError("Trop de réservations à venir avec cet email");
    }
    return { roomId: slot.roomId, end: slot.end };
  });

  // Phase 2 (hors mutex) : session Stripe si nécessaire, sans écriture locale.
  let stripeSessionId: string | null = null;
  let checkoutUrl: string | undefined;
  if (needsPayment) {
    const origin = env.BETTER_AUTH_URL.replace(/\/$/, "");
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
      success_url: `${origin}/p/${page.practitioner.slug}/merci?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/p/${page.practitioner.slug}?paiement=annule`,
    });
    if (!session.url) throw new ValidationError("Paiement en ligne indisponible pour le moment");
    stripeSessionId = session.id;
    checkoutUrl = session.url;
  }

  // Phase 3 (mutex) : insertion protégée (la garde DAL tranche les courses).
  const booked = await bookingMutex.run(async () => {
    const inserted = await bookingsDal.tryInsertBooking({
      id: bookingId,
      officeId: page.office.id,
      practitionerId: page.practitioner.id,
      roomId: checked.roomId,
      sessionTypeId: st.id,
      sessionNameSnapshot: st.name,
      durationMinSnapshot: st.durationMin,
      bufferAfterMinSnapshot: st.bufferAfterMin,
      startAt: start,
      endAt: checked.end,
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
    return { id: inserted.id, endAt: checked.end.toISOString() };
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
    // Flux classique : confirmation immédiate (best-effort : la réservation
    // reste confirmée même si l'email échoue).
    await safeSend(send, confirmationEmail(email, model, ics));
  } else if (!needsPayment) {
    // Validation praticien sans paiement : accusé de réception patient...
    // ...et notification au praticien (sinon il ne sait pas qu'il doit agir).
    await safeSend(send, validationPendingEmail(email, model));
    const pracEmail = await usersDal.getUserEmail(page.practitioner.userId);
    if (pracEmail) {
      await safeSend(
        send,
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
