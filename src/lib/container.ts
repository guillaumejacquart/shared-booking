import { env, isStripeOAuthConfigured, isSubscriptionEnabled } from "@/lib/env";
import { createMailer } from "@/lib/email";
import { createAnalyticsPort, hostnameOf } from "@/lib/analytics";
import { createCalendarClient, getGoogleAccessToken } from "@/lib/google-calendar";
import {
  systemClock,
  type GoogleCalendarPort,
  type Ports,
  type StripeLike,
} from "@/lib/ports";
import { createBookingsService, type BookingsService } from "@/services/bookings";
import { createCalendarService, type CalendarService } from "@/services/calendar";
import { createGoogleService, type GoogleService } from "@/services/google";
import { createApiTokensService, type ApiTokensService } from "@/services/api-tokens";
import { createBillingService, type BillingService } from "@/services/billing";
import { createStripeConnectService, type StripeConnectService } from "@/services/stripe-connect";
import { createStatsService, type StatsService } from "@/services/stats";
import { createRemindersService, type RemindersService } from "@/services/reminders";
import { createScheduleService, type ScheduleService } from "@/services/schedule";
import { createTeamService, type TeamService } from "@/services/team";
import Stripe from "stripe";

/**
 * Composition root : le SEUL endroit où les adaptateurs réels sont construits
 * puis injectés dans les services. Les routes et le cron n'importent que
 * `services` ; les tests appellent `makeServices({ ...overrides })` avec des
 * fakes (horloge figée, capture d'emails, faux Stripe/Google).
 */

/** Client Stripe plateforme ; null si le paiement en ligne n'est pas configuré. */
function realStripe(): StripeLike | null {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key) as unknown as StripeLike;
}

/** Port Google réel : client OAuth frais pour l'utilisateur demandé. */
const realGoogleCalendar: GoogleCalendarPort = {
  forUser: async (userId) => {
    const token = await getGoogleAccessToken(userId);
    return token ? createCalendarClient(token) : null;
  },
};

export interface Services {
  apiTokens: ApiTokensService;
  billing: BillingService;
  stripeConnect: StripeConnectService;
  bookings: BookingsService;
  team: TeamService;
  reminders: RemindersService;
  schedule: ScheduleService;
  stats: StatsService;
  google: GoogleService;
  calendar: CalendarService;
}

export function makeServices(overrides: Partial<Ports> = {}): Services {
  const ports: Ports = {
    clock: systemClock,
    sendEmail: createMailer(),
    analytics: createAnalyticsPort({
      hostUrl: env.UMAMI_HOST,
      websiteId: env.UMAMI_WEBSITE_ID,
      hostname: hostnameOf(env.BETTER_AUTH_URL),
    }),
    stripeClient: realStripe(),
    stripeOAuth: isStripeOAuthConfigured
      ? { clientId: env.STRIPE_CLIENT_ID as string, stateSecret: env.BETTER_AUTH_SECRET }
      : null,
    subscriptionPriceId: env.STRIPE_SUBSCRIPTION_PRICE_ID ?? null,
    subscriptionEnabled: isSubscriptionEnabled,
    googleCalendar: realGoogleCalendar,
    ...overrides,
  };
  return {
    apiTokens: createApiTokensService(ports),
    billing: createBillingService(ports),
    stripeConnect: createStripeConnectService(ports),
    bookings: createBookingsService(ports),
    team: createTeamService(ports),
    reminders: createRemindersService(ports),
    schedule: createScheduleService(ports),
    stats: createStatsService(ports),
    google: createGoogleService(ports),
    calendar: createCalendarService(),
  };
}

/** Services câblés au réel (singleton du processus Node). */
export const services: Services = makeServices();
