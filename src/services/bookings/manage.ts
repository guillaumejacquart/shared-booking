import * as bookingsDal from "@/dal/bookings";
import * as membersDal from "@/dal/members";
import type { Booking, BookingDetail, Office, Practitioner } from "@/dal/types";
import * as usersDal from "@/dal/users";
import {
  patientCancelledEmail,
  practitionerCancelledEmail,
  rescheduledEmail,
  type SendEmail,
} from "@/lib/email";
import type { Ports } from "@/lib/ports";
import { ANALYTICS_EVENTS } from "@/lib/analytics";
import type {
  BookingResult,
  CancelInput,
  RescheduleInput,
  ValidateInput,
} from "@/lib/schemas/bookings";
import { dateStrInTz } from "@/lib/timezone";
import { generateSlots } from "@/services/slot-engine";
import { bookingMutex } from "@/lib/mutex";
import {
  ConflictError,
  DeadlineError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../errors";
import {
  bookingEventData,
  deadline,
  mailModel,
} from "./shared";
import { syncBookingToGoogle } from "../google-sync";
import { loadSlotContext } from "./slots";
import { finalizeBookingIfReady } from "./payment";

// --- Validation praticien ----------------------------------------------------

/** Le praticien du RDV ou un owner actif du cabinet peut valider. */
async function assertCanValidate(
  detail: BookingDetail,
  requesterUserId: string,
): Promise<void> {
  const { practitioner: prac, office } = detail;
  if (prac.userId === requesterUserId && prac.active) return;
  const membership = await membersDal.getMembership(office.id, requesterUserId);
  if (!membership || membership.role !== "owner" || !membership.active) {
    throw new ForbiddenError("Seul le praticien ou le responsable peut valider");
  }
}

/**
 * Valide (confirme) ou refuse une demande en attente de validation.
 * Autorisé : le praticien du RDV ou un owner du cabinet.
 */
export async function validateBooking(
  ports: Ports,
  input: ValidateInput,
): Promise<{ id: string; status: string }> {
  const now = ports.clock.now();
  const send = ports.sendEmail;

  const detail = await bookingsDal.getBookingById(input.bookingId);
  if (!detail) throw new NotFoundError("Réservation introuvable");
  const { booking } = detail;
  if (booking.status !== "pending" || !booking.validationRequired || booking.validatedAt) {
    throw new ConflictError("Cette réservation n'est plus à valider");
  }
  await assertCanValidate(detail, input.requesterUserId);
  if (booking.paymentStatus === "pending") {
    throw new ConflictError("Paiement en attente");
  }

  const model = mailModel(booking, detail, { now });
  const eventData = bookingEventData({
    practitionerSlug: detail.practitioner.slug,
    durationMin: booking.durationMinSnapshot,
    requiresValidation: booking.validationRequired ?? false,
  });
  if (input.accept) {
    await bookingsDal.markBookingValidated(booking.id, now);
    await ports.analytics.track(ANALYTICS_EVENTS.BOOKING_VALIDATED, {
      ...eventData,
      accepted: true,
    });
    await finalizeBookingIfReady(ports, booking.id);
    return { id: booking.id, status: "confirmed" };
  }
  if (!input.reason) throw new ValidationError("Un motif de refus est requis");
  await bookingsDal.markBookingCancelled(booking.id, input.reason, now, "practitioner");
  await ports.analytics.track(ANALYTICS_EVENTS.BOOKING_VALIDATED, {
    ...eventData,
    accepted: false,
  });
  await send(practitionerCancelledEmail(booking.patientEmail, { ...model, reason: input.reason }));
  // Jamais confirmé donc jamais poussé ; synchro défensive (supprime le
  // miroir Google s'il existe).
  await syncBookingToGoogle(ports, booking.id);
  return { id: booking.id, status: "cancelled" };
}

// --- Annulation --------------------------------------------------------------

export async function cancelBooking(
  ports: Ports,
  input: CancelInput,
): Promise<{ id: string; status: string }> {
  const now = ports.clock.now();
  const send = ports.sendEmail;

  const detail = await bookingsDal.findBookingByCancelToken(input.token);
  if (!detail) throw new NotFoundError("Réservation introuvable");
  const { booking, practitioner: prac, office } = detail;
  if (booking.status === "cancelled") return { id: booking.id, status: booking.status };

  if (input.by === "patient") {
    if (now.getTime() > deadline(office, booking.startAt).getTime()) {
      throw new DeadlineError(
        "Annulation en ligne impossible : contactez directement le praticien",
      );
    }
  } else if (!input.reason) {
    throw new ValidationError("Un motif d'annulation est requis");
  }

  await bookingsDal.markBookingCancelled(booking.id, input.reason ?? null, now, input.by);

  // Pas de lien de gestion dans un email d'annulation : `manageUrl` vide.
  const model = { ...mailModel(booking, detail, { now }), manageUrl: "" };
  if (input.by === "patient") {
    const pracEmail = await usersDal.getUserEmail(prac.userId);
    if (pracEmail) {
      await send(
        patientCancelledEmail(pracEmail, {
          ...model,
          patientName: `${booking.patientFirstName} ${booking.patientLastName}`,
        }),
      );
    }
  } else {
    await send(
      practitionerCancelledEmail(booking.patientEmail, { ...model, reason: input.reason! }),
    );
  }
  await syncBookingToGoogle(ports, booking.id);
  return { id: booking.id, status: "cancelled" };
}

// --- Report ------------------------------------------------------------------

/**
 * Déplace la réservation vers `newStart` sous mutex (vérification de la grille
 * puis écriture), comme dans createBooking. Retourne le créneau cible.
 */
async function moveBookingToNewSlot(args: {
  booking: Booking;
  prac: Practitioner;
  office: Office;
  newStart: Date;
  now: Date;
}): Promise<{ start: Date; end: Date }> {
  const { booking, prac, office, newStart, now } = args;
  return bookingMutex.run(async () => {
    const tz = office.timezone;
    const dateStr = dateStrInTz(newStart, tz);
    const engineFrom = now;
    const horizonEnd = new Date(newStart.getTime() + 86_400_000);
    const context = await loadSlotContext(prac.id, office.id, engineFrom, horizonEnd, tz, booking.id, booking.sessionTypeId ?? undefined);
    const allSlots = generateSlots({
      timezone: tz,
      ...context,
      sessionDurationMin: booking.durationMinSnapshot,
      bufferAfterMin: booking.bufferAfterMinSnapshot,
      slotStepMin: prac.slotStepMin ?? 15,
      leadTimeMin: office.bookingLeadTimeMin,
      from: engineFrom,
      days: Math.max(
        1,
        Math.ceil((horizonEnd.getTime() - engineFrom.getTime()) / 86_400_000),
      ),
    }).filter((slot) => dateStrInTz(slot.start, tz) === dateStr);

    const found = allSlots.find((slot) => slot.start.getTime() === newStart.getTime());
    if (!found) throw new ConflictError("Nouveau créneau indisponible");

    const moved = await bookingsDal.tryMoveBooking(booking.id, {
      startAt: found.start,
      endAt: found.end,
      roomId: found.roomId,
    });
    if (!moved) throw new ConflictError("Nouveau créneau indisponible");
    return { start: found.start, end: found.end };
  });
}

export async function rescheduleBooking(
  ports: Ports,
  input: RescheduleInput,
): Promise<BookingResult> {
  const now = ports.clock.now();
  const send: SendEmail = ports.sendEmail;

  const detail = await bookingsDal.findBookingByRescheduleToken(input.token);
  if (!detail) throw new NotFoundError("Réservation introuvable");
  const { booking, practitioner: prac, office } = detail;
  if (booking.status !== "confirmed") {
    throw new ConflictError("Cette réservation n'est plus modifiable");
  }
  if (now.getTime() > deadline(office, booking.startAt).getTime()) {
    throw new DeadlineError(
      "Report en ligne impossible : contactez directement le praticien",
    );
  }

  const newStart = new Date(input.newStartAt);
  if (Number.isNaN(newStart.getTime()) || newStart.getTime() <= now.getTime()) {
    throw new ValidationError("Nouvel horaire invalide");
  }

  // La séance garde son type d'origine (snapshots) : le moteur régénère la
  // grille du jour cible avec durée/buffer d'origine et vérifie l'alignement.
  const target = await moveBookingToNewSlot({ booking, prac, office, newStart, now });

  const model = mailModel(booking, detail, { now, ...target });
  await send(rescheduledEmail(booking.patientEmail, model));
  await syncBookingToGoogle(ports, booking.id);

  return {
    id: booking.id,
    status: "confirmed",
    startAt: target.start.toISOString(),
    endAt: target.end.toISOString(),
    cancelToken: booking.cancelToken,
    rescheduleToken: booking.rescheduleToken,
    requiresPayment: false,
  };
}
