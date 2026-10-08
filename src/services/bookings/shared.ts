import { randomBytes } from "node:crypto";

import type { Booking, BookingDetail, Practitioner, SessionTypeVariant } from "@/dal/types";
import * as usersDal from "@/dal/users";
import type { AnalyticsData } from "@/lib/analytics";
import { env } from "@/lib/env";
import {
  buildIcs,
  validationRequestEmail,
  type BookingMailPayload,
  type OnsitePaymentLine,
  type OutgoingEmail,
  type SendEmail,
} from "@/lib/email";
import { googleCalendarTemplateUrl } from "@/lib/google-template";
import {
  formatOnsitePaymentMethods,
  formatPayablePrice,
  ONSITE_METHOD_LABELS_FR,
  parseOnsitePaymentMethods,
} from "@/lib/onsite-payments";
import type { Ports } from "@/lib/ports";

/**
 * Service réservation (logique métier). Appelé par les routes HTTP et le cron.
 * - Le temps, les emails, Stripe et Google viennent des ports (`@/lib/ports`),
 *   câblés dans `@/lib/container`.
 * - La salle n'est jamais exposée au public (détail interne au cabinet).
 */

/** Durée de tenue du créneau pendant le paiement (puis libération auto). */
export const PENDING_TTL_MS = 30 * 60_000;

export const MAX_FUTURE_PER_EMAIL = 3;
export const MAX_BUFFER_MIN = 480; // garde-fou cohérent avec la marge SQL (±24h);

/**
 * Snapshots tarifaires figés à la réservation : le CA des stats reste
 * stable même si la variante change ou est supprimée ensuite.
 */
export function tariffSnapshot(
  currency: string | null,
  variant: Pick<SessionTypeVariant, "priceCents" | "priceDisplay">,
): { priceCentsSnapshot: number | null; priceDisplaySnapshot: string | null; currencySnapshot: string } {
  return {
    priceCentsSnapshot: variant.priceCents ?? null,
    priceDisplaySnapshot: variant.priceDisplay ?? null,
    currencySnapshot: currency ?? "eur",
  };
}

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

/** Champs de réservation nécessaires au contenu d'un email. */
export type MailBooking = Pick<
  Booking,
  | "id"
  | "sessionNameSnapshot"
  | "startAt"
  | "endAt"
  | "patientEmail"
  | "cancelToken"
  | "paymentStatus"
  | "priceDisplaySnapshot"
  | "currencySnapshot"
>;

/**
 * Détail du règlement sur place : réservation sans paiement en ligne
 * (`paymentStatus === "none"`) + tarif affiché non gratuit. Les moyens et
 * la précision viennent du réglage praticien (libellés FR pour les emails).
 */
function onsitePaymentLine(
  booking: MailBooking,
  practitioner: Pick<Practitioner, "onsitePaymentMethods" | "onsitePaymentNote">,
): OnsitePaymentLine | null {
  if (booking.paymentStatus !== "none") return null;
  const price = formatPayablePrice(booking.priceDisplaySnapshot, booking.currencySnapshot ?? "eur");
  if (!price) return null;
  const note = practitioner.onsitePaymentNote?.trim();
  return {
    price,
    methods: formatOnsitePaymentMethods(
      parseOnsitePaymentMethods(practitioner.onsitePaymentMethods),
      ONSITE_METHOD_LABELS_FR,
    ),
    note: note ? note : null,
  };
}

/**
 * Modèle d'email + dérivés calendrier à partir d'une réservation et de son
 * détail. Source unique du contenu « rendez-vous » : le titre, le lieu et les
 * horaires sont dérivés une seule fois ici, puis servent au modèle textuel,
 * à la pièce ICS et au lien Google Agenda. Les call sites n'assemblent jamais
 * les pièces à la main.
 *
 * `start`/`end` décrivent le créneau cible (report) sans toucher à la
 * réservation ; `now` date la pièce ICS.
 */
export function mailModel(
  booking: MailBooking,
  detail: Pick<BookingDetail, "practitioner" | "office">,
  options: { now: Date; start?: Date; end?: Date },
): BookingMailPayload {
  const start = options.start ?? booking.startAt;
  const end = options.end ?? booking.endAt;
  const title = `${booking.sessionNameSnapshot} — ${detail.practitioner.displayName}`;
  const location = detail.office.address
    ? `${detail.office.name}, ${detail.office.address}`
    : detail.office.name;
  const url = manageUrl(detail.office.slug, detail.practitioner.slug, booking.cancelToken);
  return {
    practitionerName: detail.practitioner.displayName,
    sessionName: booking.sessionNameSnapshot,
    start,
    timeZone: detail.office.timezone,
    officeName: detail.office.name,
    officeAddress: detail.office.address,
    manageUrl: url,
    onsitePayment: onsitePaymentLine(booking, detail.practitioner),
    ics: buildIcs({
      uid: booking.id,
      summary: title,
      location,
      start,
      end,
      stamp: options.now,
      attendeeEmail: booking.patientEmail,
    }),
    googleUrl: googleCalendarTemplateUrl({
      title,
      start,
      end,
      location,
      description: url,
    }),
  };
}

/**
 * Données analytics d'une réservation (source unique) : dimensions
 * agrégeables uniquement, jamais de PII (le sanitize du port les
 * refuserait de toute façon). Utilisé par create/payment/manage.
 */
export function bookingEventData(args: {
  practitionerSlug: string;
  durationMin: number;
  requiresValidation: boolean;
}): AnalyticsData {
  return {
    practitionerSlug: args.practitionerSlug,
    durationMin: args.durationMin,
    requiresValidation: args.requiresValidation,
  };
}

/** Notifie le praticien qu'une demande attend sa validation (sinon il ne le sait jamais). */
export async function notifyValidationRequest(
  ports: Ports,
  detail: Pick<BookingDetail, "practitioner" | "office">,
  booking: MailBooking & Pick<Booking, "patientFirstName" | "patientLastName">,
): Promise<void> {
  const pracEmail = await usersDal.getUserEmail(detail.practitioner.userId);
  if (!pracEmail) return;
  await safeSend(
    ports.sendEmail,
    validationRequestEmail(pracEmail, {
      ...mailModel(booking, detail, { now: ports.clock.now() }),
      patientName: `${booking.patientFirstName} ${booking.patientLastName}`,
    }),
  );
}

/**
 * Envoi best-effort après commit : un email qui échoue ne doit pas annuler
 * une réservation déjà confirmée (log + poursuite).
 */
export async function safeSend(send: SendEmail, email: OutgoingEmail): Promise<void> {
  try {
    await send(email);
  } catch (error) {
    console.error("[bookings] envoi email impossible", { to: email.to, error });
  }
}
