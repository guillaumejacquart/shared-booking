import { randomBytes } from "node:crypto";

import type { Booking, BookingDetail, Office } from "@/dal/types";
import * as usersDal from "@/dal/users";
import { env, isStripeConfigured } from "@/lib/env";
import {
  buildIcs,
  createMailer,
  validationRequestEmail,
  type BookingMailModel,
  type OutgoingEmail,
  type SendEmail,
} from "@/lib/email";
import Stripe from "stripe";

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

export function realStripe(): StripeLike | null {
  if (!isStripeConfigured) return null;
  const stripe = new Stripe(env.STRIPE_SECRET_KEY!);
  return stripe as unknown as StripeLike;
}

/** Durée de tenue du créneau pendant le paiement (puis libération auto). */
export const PENDING_TTL_MS = 30 * 60_000;

export const MAX_FUTURE_PER_EMAIL = 3;
export const MAX_BUFFER_MIN = 480; // garde-fou cohérent avec la marge SQL (±24h);

export function tokens() {
  return {
    cancelToken: randomBytes(32).toString("hex"),
    rescheduleToken: randomBytes(32).toString("hex"),
  };
}

export function deadline(office: { cancelDeadlineHours: number }, startAt: Date): Date {
  return new Date(startAt.getTime() - office.cancelDeadlineHours * 3_600_000);
}

export function manageUrl(officeSlug: string, practitionerSlug: string, token: string): string {
  // URL absolue pour les emails (BETTER_AUTH_URL = origine publique de l'app).
  const base = env.BETTER_AUTH_URL.replace(/\/$/, "");
  return `${base}/p/${practitionerSlug}/gerer?token=${token}&cabinet=${officeSlug}`;
}

/** Modèle d'email commun à partir d'une réservation et de son détail. */
export function mailModel(
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
export function bookingIcs(
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
export async function notifyValidationRequest(
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

export function defaultSend(): SendEmail {
  return createMailer();
}

/**
 * Envoi best-effort après commit : un email qui échoue ne doit pas annuler
 * une réservation déjà confirmée (log + poursuite).
 */
export async function safeSend(send: SendEmail, email: OutgoingEmail): Promise<void> {
  try {
    await send(email);
  } catch (e) {
    console.error("[bookings] envoi email impossible", { to: email.to, error: e });
  }
}
