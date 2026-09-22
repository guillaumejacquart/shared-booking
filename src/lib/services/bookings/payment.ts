import * as bookingsDal from "@/dal/bookings";
import {
  confirmationEmail,
  paymentReceivedEmail,
  type SendEmail,
} from "@/lib/email";
import type { ApplyPaymentInput } from "@/lib/schemas/bookings";
import {
  bookingIcs,
  defaultSend,
  mailModel,
  notifyValidationRequest,
  type Deps,
} from "./shared";

// --- Paiement ----------------------------------------------------------------

/**
 * Webhook Stripe `checkout.session.completed` : marque payé puis confirme
 * si aucune validation praticien n'est requise. Idempotent (retries Stripe).
 */
export async function applyPaymentCompleted(
  deps: Deps,
  input: ApplyPaymentInput,
): Promise<{ applied: boolean; confirmed: boolean }> {
  const send = deps.sendEmail ?? defaultSend();

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
  const send: SendEmail = deps.sendEmail ?? defaultSend();
  // Une seule lecture (réservation + détail) au lieu de deux requêtes.
  const detail = await bookingsDal.getBookingById(bookingId);
  if (!detail) return false;
  const b = detail.booking;
  if (b.status !== "pending") return false;
  if (b.paymentStatus === "pending") return false;
  if (b.validationRequired && !b.validatedAt) {
    // Payé mais en attente de validation : on prévient le patient.
    if (b.paymentStatus === "paid") {
      await send(paymentReceivedEmail(b.patientEmail, mailModel(b, detail)));
      await notifyValidationRequest(send, detail, b);
    }
    return false;
  }
  await bookingsDal.markBookingConfirmed(b.id);
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
