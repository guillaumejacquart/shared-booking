import * as bookingsDal from "@/dal/bookings";
import * as membersDal from "@/dal/members";
import * as usersDal from "@/dal/users";
import {
  createMailer,
  patientCancelledEmail,
  practitionerCancelledEmail,
  rescheduledEmail,
  type SendEmail,
} from "@/lib/email";
import type { CancelInput, RescheduleInput, ValidateInput } from "@/lib/schemas/bookings";
import { dateStrInTz } from "@/lib/timezone";
import { generateSlots } from "@/lib/slots";
import { bookingMutex } from "@/lib/mutex";
import {
  ConflictError,
  DeadlineError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../errors";
import {
  bookingIcs,
  deadline,
  defaultSend,
  mailModel,
  type Deps,
} from "./shared";
import { loadSlotContext } from "./slots";
import { finalizeBookingIfReady } from "./payment";

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
  const send = deps.sendEmail ?? defaultSend();

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
): Promise<import("@/lib/schemas/bookings").BookingResult> {
  const now = deps.now ?? new Date();
  const send: SendEmail = deps.sendEmail ?? defaultSend();

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
