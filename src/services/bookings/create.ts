import * as bookingsDal from "@/dal/bookings";
import * as practitionersDal from "@/dal/practitioners";
import type { NewBooking } from "@/dal/types";
import { confirmationEmail, validationPendingEmail } from "@/lib/email";
import { env } from "@/lib/env";
import type { Ports, StripeLike } from "@/lib/ports";
import type { BookingResult, CreateBookingInput } from "@/lib/schemas/bookings";
import { ANALYTICS_EVENTS } from "@/lib/analytics";
import { dateStrInTz } from "@/lib/timezone";
import { bookingMutex } from "@/lib/mutex";
import type { Slot } from "@/services/slot-engine";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import {
  mailModel,
  bookingEventData,
  MAX_BUFFER_MIN,
  MAX_FUTURE_PER_EMAIL,
  notifyValidationRequest,
  PENDING_TTL_MS,
  safeSend,
  tariffSnapshot,
  tokens,
  type MailBooking,
} from "./shared";
import { getSlotsWithRoom, resolveVariant, slotOnGrid } from "./slots";
import { syncBookingToGoogle } from "../google-sync";
import type { SessionTypeVariant } from "@/dal/types";

type PractitionerPage = NonNullable<
  Awaited<ReturnType<typeof practitionersDal.getPractitionerPage>>
>;
type PageSessionType = PractitionerPage["sessionTypes"][number];

/**
 * Résout le créneau demandé dans la grille du jour (avec sa salle).
 * Distingue hors-grille (400) de pris (409) via la grille sans occupation.
 */
async function resolveSlot(
  ports: Ports,
  page: PractitionerPage,
  st: PageSessionType,
  variant: SessionTypeVariant,
  start: Date,
): Promise<Slot> {
  const dateStr = dateStrInTz(start, page.office.timezone);
  const slot = (
    await getSlotsWithRoom(ports, {
      practitionerSlug: page.practitioner.slug,
      sessionTypeId: st.id,
      sessionVariantId: variant.id,
      fromDate: dateStr,
      days: 1,
    })
  ).find((candidate) => candidate.start.toISOString() === start.toISOString());
  if (!slot) {
    const onGrid = await slotOnGrid(
      page.practitioner.id,
      page.office.id,
      st.id,
      variant.durationMin,
      variant.bufferAfterMin,
      start,
      page.office.timezone,
    );
    if (!onGrid) throw new ValidationError("Créneau invalide");
    throw new ConflictError("Créneau déjà réservé");
  }
  return slot;
}

// --- Création ---------------------------------------------------------------

/** Refuse une demande mal configurée ou hors délai de réservation. */
function assertBookable(
  page: PractitionerPage,
  variant: SessionTypeVariant,
  start: Date,
  now: Date,
): void {
  if (variant.bufferAfterMin > MAX_BUFFER_MIN) {
    throw new ValidationError("Configuration de séance invalide");
  }
  if (Number.isNaN(start.getTime())) throw new ValidationError("Horaire invalide");
  if (start.getTime() < now.getTime() + page.office.bookingLeadTimeMin * 60_000) {
    throw new ValidationError("Ce créneau n'est plus réservable");
  }
}

/**
 * Phase 1 (mutex) : créneau + quota vérifiés AVANT tout appel Stripe
 * (pas de session orpheline si le créneau est pris ou le quota dépassé).
 */
async function lockSlot(
  ports: Ports,
  page: PractitionerPage,
  st: PageSessionType,
  variant: SessionTypeVariant,
  start: Date,
  email: string,
  now: Date,
): Promise<{ roomId: string; end: Date }> {
  return bookingMutex.run(async () => {
    const slot = await resolveSlot(ports, page, st, variant, start);
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
}

/** Phase 2 (hors mutex) : session Stripe, sans écriture locale. */
async function createCheckoutSession(args: {
  stripe: StripeLike;
  st: PageSessionType;
  variant: SessionTypeVariant;
  page: PractitionerPage;
  email: string;
  bookingId: string;
  now: Date;
}): Promise<{ stripeSessionId: string; checkoutUrl: string }> {
  const { stripe, st, variant, page, email, bookingId, now } = args;
  const destination = page.practitioner.stripeAccountId;
  if (!destination) throw new ValidationError("Paiement en ligne indisponible pour ce praticien");
  const origin = env.BETTER_AUTH_URL.replace(/\/$/, "");
  const fee = env.STRIPE_APPLICATION_FEE_CENTS;
  const priceCents = variant.priceCents;
  if (!priceCents || priceCents <= 0) {
    throw new ValidationError("Séance mal configurée : prix manquant");
  }
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: email,
    line_items: [
      {
        price_data: {
          currency: st.currency ?? "eur",
          unit_amount: priceCents,
          product_data: { name: `${st.name} (${variant.durationMin} min) — ${page.practitioner.displayName}` },
        },
        quantity: 1,
      },
    ],
    payment_intent_data: {
      transfer_data: { destination },
      ...(fee > 0 && fee < priceCents ? { application_fee_amount: fee } : {}),
    },
    metadata: { bookingId },
    expires_at: Math.floor((now.getTime() + PENDING_TTL_MS) / 1000),
    success_url: `${origin}/p/${page.practitioner.slug}/merci?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/p/${page.practitioner.slug}?paiement=annule`,
  });
  if (!session.url) throw new ValidationError("Paiement en ligne indisponible pour le moment");
  return { stripeSessionId: session.id, checkoutUrl: session.url };
}

/** Phase 3 (mutex) : insertion protégée (la garde DAL tranche les courses). */
async function insertBookingGuarded(data: NewBooking): Promise<string> {
  return bookingMutex.run(async () => {
    const inserted = await bookingsDal.tryInsertBooking(data);
    if (inserted.conflict) throw new ConflictError("Créneau déjà réservé");
    return inserted.id;
  });
}

/** Emails post-insertion selon le statut (confirmé / à valider / à payer). */
async function sendCreationEmails(
  ports: Ports,
  page: PractitionerPage,
  booking: MailBooking & { patientFirstName: string; patientLastName: string },
  opts: { confirmed: boolean; needsPayment: boolean },
): Promise<void> {
  const send = ports.sendEmail;
  const model = mailModel(booking, page, { now: ports.clock.now() });
  if (opts.confirmed) {
    // Flux classique : confirmation immédiate (best-effort : la réservation
    // reste confirmée même si l'email échoue), puis push Google Agenda
    // (best-effort aussi : échec persisté, retry par le cron).
    await safeSend(send, confirmationEmail(booking.patientEmail, model));
    await syncBookingToGoogle(ports, booking.id);
    return;
  }
  // Cas payant : aucun email avant le paiement (le webhook confirme).
  if (opts.needsPayment) return;
  // Validation praticien sans paiement : accusé de réception patient...
  await safeSend(send, validationPendingEmail(booking.patientEmail, model));
  // ...et notification au praticien (sinon il ne sait pas qu'il doit agir).
  await notifyValidationRequest(ports, page, booking);
}

/**
 * Résout et valide la demande : page praticien, type de séance, créneau,
 * options paiement/validation. Lève les erreurs métier (404/400) avant toute
 * écriture.
 */
async function resolveBookingPlan(
  ports: Ports,
  input: CreateBookingInput,
): Promise<{
  page: PractitionerPage;
  st: PageSessionType;
  variant: SessionTypeVariant;
  start: Date;
  now: Date;
  email: string;
  needsPayment: boolean;
  needsValidation: boolean;
  stripe: StripeLike | null;
}> {
  const now = ports.clock.now();
  const page = await practitionersDal.getPractitionerPage(input.practitionerSlug);
  if (!page) throw new NotFoundError("Praticien introuvable");
  const st = page.sessionTypes.find((sessionType) => sessionType.id === input.sessionTypeId);
  if (!st) throw new NotFoundError("Type de séance introuvable");
  const variant = resolveVariant(st, input.sessionVariantId);

  const start = new Date(input.startAt);
  assertBookable(page, variant, start, now);
  const needsPayment = st.requiresPayment;
  const needsValidation = st.requiresValidation;
  if (needsPayment && (!variant.priceCents || variant.priceCents <= 0)) {
    throw new ValidationError("Séance mal configurée : prix manquant");
  }
  const stripe = needsPayment ? ports.stripeClient : null;
  if (needsPayment && !stripe) {
    throw new ValidationError("Paiement en ligne indisponible pour le moment");
  }
  // Connect : le praticien doit avoir lié son compte et fini son onboarding.
  if (needsPayment && (!page.practitioner.stripeAccountId || !page.practitioner.stripeChargesEnabled)) {
    throw new ValidationError("Paiement en ligne indisponible pour ce praticien");
  }
  return {
    page,
    st,
    variant,
    start,
    now,
    email: input.patientEmail.toLowerCase(),
    needsPayment,
    needsValidation,
    stripe,
  };
}

export async function createBooking(ports: Ports, input: CreateBookingInput): Promise<BookingResult> {
  const { page, st, variant, start, now, email, needsPayment, needsValidation, stripe } =
    await resolveBookingPlan(ports, input);
  const { cancelToken, rescheduleToken } = tokens();
  const bookingId = crypto.randomUUID();
  const status = needsPayment || needsValidation ? "pending" : "confirmed";

  const checked = await lockSlot(ports, page, st, variant, start, email, now);
  const checkout = stripe
    ? await createCheckoutSession({ stripe, st, variant, page, email, bookingId, now })
    : null;

  const row: NewBooking = {
    id: bookingId,
    officeId: page.office.id,
    practitionerId: page.practitioner.id,
    roomId: checked.roomId,
    sessionTypeId: st.id,
    sessionVariantId: variant.id,
    // Multi-déclinaisons : la durée fige la variante dans l'historique
    // (agenda, emails) ; variante unique : nom inchangé (historique).
    sessionNameSnapshot:
      st.variants.length > 1 ? `${st.name} (${variant.durationMin} min)` : st.name,
    durationMinSnapshot: variant.durationMin,
    bufferAfterMinSnapshot: variant.bufferAfterMin,
    // Snapshots tarifaires : figent le prix affiché au patient pour les
    // stats/CA, même si la variante change ou est supprimée ensuite.
    ...tariffSnapshot(st.currency, variant),
    startAt: start,
    endAt: checked.end,
    patientFirstName: input.patientFirstName,
    patientLastName: input.patientLastName,
    patientEmail: email,
    patientPhone: input.patientPhone,
    notes: input.notes,
    cancelToken,
    rescheduleToken,
    status,
    paymentStatus: needsPayment ? "pending" : "none",
    stripeSessionId: checkout?.stripeSessionId ?? null,
    validationRequired: needsValidation,
    pendingExpiresAt: needsPayment ? new Date(now.getTime() + PENDING_TTL_MS) : null,
  };
  const bookedId = await insertBookingGuarded(row);
  await sendCreationEmails(ports, page, row, {
    confirmed: status === "confirmed",
    needsPayment,
  });
  // Analytics best-effort après commit : la réservation existe déjà,
  // un tracking qui échoue ne change rien (le port ne throw jamais).
  if (status === "confirmed") {
    await ports.analytics.track(
      ANALYTICS_EVENTS.BOOKING_CONFIRMED,
      bookingEventData({
        practitionerSlug: page.practitioner.slug,
        durationMin: variant.durationMin,
        requiresValidation: needsValidation,
      }),
    );
  } else if (needsPayment) {
    await ports.analytics.track(
      ANALYTICS_EVENTS.BOOKING_PAYMENT_STARTED,
      bookingEventData({
        practitionerSlug: page.practitioner.slug,
        durationMin: variant.durationMin,
        requiresValidation: needsValidation,
      }),
    );
  }

  return {
    id: bookedId,
    status,
    startAt: start.toISOString(),
    endAt: checked.end.toISOString(),
    cancelToken,
    rescheduleToken,
    requiresPayment: needsPayment,
    ...(checkout ? { checkoutUrl: checkout.checkoutUrl } : {}),
  };
}
