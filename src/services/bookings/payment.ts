import * as bookingsDal from "@/dal/bookings";
import {
  confirmationEmail,
  paymentReceivedEmail,
  type SendEmail,
} from "@/lib/email";
import type { Ports } from "@/lib/ports";
import type { ApplyPaymentInput } from "@/lib/schemas/bookings";
import {
  mailModel,
  notifyValidationRequest,
} from "./shared";
import { syncBookingToGoogle } from "../google-sync";

// --- Paiement ----------------------------------------------------------------

/**
 * Webhook Stripe `checkout.session.completed` : marque payé puis confirme
 * si aucune validation praticien n'est requise. Idempotent (retries Stripe).
 */
export async function applyPaymentCompleted(
  ports: Ports,
  input: ApplyPaymentInput,
): Promise<{ applied: boolean; confirmed: boolean }> {
  const detail = await bookingsDal.findBookingByStripeSession(input.stripeSessionId);
  if (!detail) return { applied: false, confirmed: false };
  const { booking } = detail;
  if (booking.paymentStatus === "paid") return { applied: false, confirmed: false };
  if (booking.status !== "pending") return { applied: false, confirmed: false };

  await bookingsDal.markBookingPaid(booking.id, input.paymentIntentId);
  const confirmed = await finalizeBookingIfReady(ports, booking.id);
  return { applied: true, confirmed };
}

/**
 * Bascule un `pending` en `confirmed` quand tout est réuni (payé si requis,
 * validé si requis) + email de confirmation. Utilisé par le webhook et,
 * plus tard, par la validation praticien.
 */
export async function finalizeBookingIfReady(
  ports: Ports,
  bookingId: string,
): Promise<boolean> {
  const send: SendEmail = ports.sendEmail;
  // Une seule lecture (réservation + détail) au lieu de deux requêtes.
  const detail = await bookingsDal.getBookingById(bookingId);
  if (!detail) return false;
  const { booking } = detail;
  if (booking.status !== "pending") return false;
  if (booking.paymentStatus === "pending") return false;
  if (booking.validationRequired && !booking.validatedAt) {
    // Payé mais en attente de validation : on prévient le patient.
    if (booking.paymentStatus === "paid") {
      await send(paymentReceivedEmail(booking.patientEmail, mailModel(booking, detail, { now: ports.clock.now() })));
      await notifyValidationRequest(ports, detail, booking);
    }
    return false;
  }
  await bookingsDal.markBookingConfirmed(booking.id);
  await send(confirmationEmail(booking.patientEmail, mailModel(booking, detail, { now: ports.clock.now() })));
  await syncBookingToGoogle(ports, booking.id);
  return true;
}

/** Libère les pendings dont le paiement a expiré (cron). */
export async function releaseExpiredPendings(ports: Ports): Promise<number> {
  const now = ports.clock.now();
  const expired = await bookingsDal.listExpiredPendings(now);
  for (const expiredBooking of expired) {
    await bookingsDal.markBookingCancelled(expiredBooking.id, "Paiement expiré", now);
  }
  return expired.length;
}

/**
 * Statut d'une réservation payée, pour la page de retour Stripe.
 * Null si `session_id` inconnu (`session_id` fait office de secret).
 */
export async function getBookingStatusByStripeSession(stripeSessionId: string) {
  const detail = await bookingsDal.findBookingByStripeSession(stripeSessionId);
  if (!detail) return null;
  const { booking, practitioner } = detail;
  return {
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    practitionerSlug: practitioner.slug,
    sessionName: booking.sessionNameSnapshot,
    startAt: booking.startAt.toISOString(),
  };
}
