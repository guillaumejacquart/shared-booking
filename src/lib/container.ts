import { env, isStripeConfigured } from "@/lib/env";
import { createMailer } from "@/lib/email";
import { createCalendarClient, getGoogleAccessToken } from "@/lib/google-sync";
import {
  systemClock,
  type GoogleCalendarPort,
  type Ports,
  type StripeLike,
} from "@/lib/ports";
import { createBookingsService, type BookingsService } from "@/lib/services/bookings";
import { createGoogleService, type GoogleService } from "@/lib/services/google";
import { createRemindersService, type RemindersService } from "@/lib/services/reminders";
import { createScheduleService, type ScheduleService } from "@/lib/services/schedule";
import { createTeamService, type TeamService } from "@/lib/services/team";
import Stripe from "stripe";

/**
 * Composition root : le SEUL endroit où les adaptateurs réels sont construits
 * puis injectés dans les services. Les routes et le cron n'importent que
 * `services` ; les tests appellent `makeServices({ ...overrides })` avec des
 * fakes (horloge figée, capture d'emails, faux Stripe/Google).
 */

/** Client Stripe plateforme ; null si le paiement en ligne n'est pas configuré. */
function realStripe(): StripeLike | null {
  if (!isStripeConfigured) return null;
  return new Stripe(env.STRIPE_SECRET_KEY!) as unknown as StripeLike;
}

/** Port Google réel : client OAuth frais pour l'utilisateur demandé. */
const realGoogleCalendar: GoogleCalendarPort = {
  forUser: async (userId) => {
    const token = await getGoogleAccessToken(userId);
    return token ? createCalendarClient(token) : null;
  },
};

export interface Services {
  bookings: BookingsService;
  team: TeamService;
  reminders: RemindersService;
  schedule: ScheduleService;
  google: GoogleService;
}

export function makeServices(overrides: Partial<Ports> = {}): Services {
  const ports: Ports = {
    clock: systemClock,
    sendEmail: createMailer(),
    stripeClient: realStripe(),
    googleCalendar: realGoogleCalendar,
    ...overrides,
  };
  return {
    bookings: createBookingsService(ports),
    team: createTeamService(ports),
    reminders: createRemindersService(ports),
    schedule: createScheduleService(ports),
    google: createGoogleService(ports),
  };
}

/** Services câblés au réel (singleton du processus Node). */
export const services: Services = makeServices();
