import type { SendEmail } from "@/lib/email";
import type { CalendarClient } from "@/lib/google-sync";

/**
 * Ports de l'application : tout ce que les services empruntent au monde
 * extérieur (temps, emails, paiements, agenda Google) est déclaré ici.
 * Câblage réel dans `container.ts`, fakes dans les tests — un seul contrat,
 * aucune forme `deps` ad hoc par service.
 */

/** Horloge : le temps est une dépendance externe, injectée comme les autres. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** Horloge figée (tests et calculs datés). */
export function fixedClock(at: Date): Clock {
  return { now: () => at };
}

/** Sous-ensemble de l'API Stripe utilisé (checkout uniquement). */
export interface StripeLike {
  checkout: {
    sessions: {
      create(params: Record<string, unknown>): Promise<{ id: string; url: string | null }>;
    };
  };
}

/**
 * Accès à l'agenda Google d'un utilisateur : client authentifié (OAuth réel
 * via le refresh token) ou `null` si non connecté. Fake dans les tests.
 */
export interface GoogleCalendarPort {
  forUser(userId: string): Promise<CalendarClient | null>;
}

/** Les dépendances externes des services. */
export interface Ports {
  clock: Clock;
  sendEmail: SendEmail;
  stripeClient: StripeLike | null;
  googleCalendar: GoogleCalendarPort | null;
}
