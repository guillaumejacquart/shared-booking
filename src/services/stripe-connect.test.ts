import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDb } from "@/test/memory-db";
import { setConnection } from "@/dal/connection";
import type { Db } from "@/dal/types";
import { fixedClock } from "@/lib/ports";
import { ANALYTICS_EVENTS, type AnalyticsData, type AnalyticsEventName } from "@/lib/analytics";
import { testPorts } from "@/test/ports";
import { refreshConnectStatus, startConnectOnboarding } from "./stripe-connect";

let db: Db;
let chargesEnabled: boolean;

const NOW = new Date("2026-09-14T06:00:00Z");

const fakeStripe = {
  checkout: {
    sessions: {
      create: async () => ({ id: "cs_test", url: "https://checkout.stripe.test/cs" }),
    },
  },
  accounts: {
    create: async () => ({ id: "acct_test_123" }),
    retrieve: async (accountId: string) => ({
      id: accountId,
      charges_enabled: chargesEnabled,
      payouts_enabled: false,
    }),
  },
  accountLinks: {
    create: async () => ({ url: "https://connect.stripe.test/onboarding" }),
  },
  customers: {
    create: async () => ({ id: "cus_test" }),
  },
  subscriptions: {
    retrieve: async (subscriptionId: string) => ({
      id: subscriptionId,
      customer: "cus_test",
      status: "active",
      current_period_end: null,
    }),
  },
  billingPortal: {
    sessions: {
      create: async () => ({ url: "https://billing.stripe.test/portal" }),
    },
  },
};

let tracked: { event: AnalyticsEventName; data?: AnalyticsData }[];

function watchedPorts() {
  return testPorts({
    clock: fixedClock(NOW),
    stripeClient: fakeStripe,
    analytics: { track: async (event, data) => void tracked.push({ event, data }) },
  });
}

beforeEach(async () => {
  db = createMemoryDb();
  setConnection(db);
  tracked = [];
  chargesEnabled = false;
  const s = await import("@/db/schema");
  await db.insert(s.user).values([{ id: "u1", name: "Alice", email: "alice@example.com" }]);
  await db.insert(s.office).values({ id: "o1", name: "Cab", slug: "cab" });
  await db.insert(s.practitioner).values([
    { id: "p1", officeId: "o1", userId: "u1", displayName: "Alice", slug: "alice" },
  ]);
});

describe("stripe-connect analytics (Umami)", () => {
  it("démarrage de l'onboarding : stripe-connect-started", async () => {
    const out = await startConnectOnboarding(watchedPorts(), "u1");
    expect(out.accountId).toBe("acct_test_123");
    expect(tracked.map((entry) => entry.event)).toEqual([
      ANALYTICS_EVENTS.STRIPE_CONNECT_STARTED,
    ]);
  });

  it("refresh : stripe-connect-ready une seule fois à la transition", async () => {
    const ports = watchedPorts();
    await startConnectOnboarding(ports, "u1");
    tracked.length = 0;
    // KYC pas encore terminé : rien.
    const pending = await refreshConnectStatus(ports, "u1");
    expect(pending.ready).toBe(false);
    expect(tracked).toHaveLength(0);
    // KYC terminé : un seul event ready…
    chargesEnabled = true;
    const ready = await refreshConnectStatus(ports, "u1");
    expect(ready.ready).toBe(true);
    expect(tracked.map((entry) => entry.event)).toEqual([
      ANALYTICS_EVENTS.STRIPE_CONNECT_READY,
    ]);
    // …pas de doublon au refresh suivant.
    await refreshConnectStatus(ports, "u1");
    expect(tracked).toHaveLength(1);
  });
});
