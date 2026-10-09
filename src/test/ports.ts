import { systemClock, type Ports } from "@/lib/ports";

/**
 * Ports pour les tests : fakes neutres, surchargeables champ par champ.
 * `testPorts({ clock: fixedClock(NOW), sendEmail: capture })` par exemple.
 */
export function testPorts(overrides: Partial<Ports> = {}): Ports {
  return {
    clock: systemClock,
    sendEmail: async () => {},
    analytics: { track: async () => {} },
    stripeClient: null,
    stripeOAuth: null,
    googleCalendar: null,
    subscriptionPriceId: null,
    subscriptionEnabled: false,
    ...overrides,
  };
}
