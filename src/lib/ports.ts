import type { SendEmail } from "@/lib/email";
import type { CalendarClient } from "@/lib/google-calendar";

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

/** Sous-ensemble de l'API Stripe utilisé (checkout + Connect Express). */
export interface StripeAccountLike {
  id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
}

/** Abonnement Stripe minimal (facturation SaaS du cabinet). */
export interface StripeSubscriptionLike {
  id: string;
  customer: string;
  status: string;
  current_period_end: number | null;
}

export interface StripeLike {
  checkout: {
    sessions: {
      create(params: Record<string, unknown>): Promise<{ id: string; url: string | null }>;
    };
  };
  accounts: {
    create(params: Record<string, unknown>): Promise<{ id: string }>;
    retrieve(accountId: string): Promise<StripeAccountLike>;
  };
  accountLinks: {
    create(params: Record<string, unknown>): Promise<{ url: string }>;
  };
  customers: {
    create(params: Record<string, unknown>): Promise<{ id: string }>;
  };
  subscriptions: {
    retrieve(subscriptionId: string): Promise<StripeSubscriptionLike>;
  };
  billingPortal: {
    sessions: {
      create(params: Record<string, unknown>): Promise<{ url: string | null }>;
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
  /** Prix mensuel de l'abonnement cabinet (`price_...`, null = facturation off). */
  subscriptionPriceId: string | null;
  /** Feature flag abonnement : false = service complet sans paiement. */
  subscriptionEnabled: boolean;
}
