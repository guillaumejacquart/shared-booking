import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDb } from "@/test/memory-db";
import { setConnection } from "@/dal/connection";
import type { Db } from "@/dal/types";
import { fixedClock } from "@/lib/ports";
import { ANALYTICS_EVENTS, type AnalyticsData, type AnalyticsEventName } from "@/lib/analytics";
import { testPorts } from "@/test/ports";
import { ForbiddenError, ValidationError } from "./errors";
import {
  applySubscriptionEvent,
  createPortalSession,
  getBillingStatus,
  handleSubscriptionCheckout,
  refreshBillingStatus,
  startSubscriptionCheckout,
} from "./billing";

let db: Db;
let checkoutCalls: unknown[];
let customerCreates: unknown[];

const NOW = new Date("2026-09-14T06:00:00Z");
const PRICE = "price_test_10eur";

const fakeStripe = {
  checkout: {
    sessions: {
      create: async (params: unknown) => {
        checkoutCalls.push(params);
        return { id: "cs_sub_123", url: "https://checkout.stripe.test/sub/cs_sub_123" };
      },
    },
  },
  accounts: {
    create: async () => ({ id: "acct_test_123" }),
    retrieve: async (accountId: string) => ({
      id: accountId,
      charges_enabled: true,
      payouts_enabled: true,
    }),
  },
  accountLinks: {
    create: async () => ({ url: "https://connect.stripe.test/onboarding" }),
  },
  customers: {
    create: async (params: unknown) => {
      customerCreates.push(params);
      return { id: "cus_test_123" };
    },
  },
  subscriptions: {
    retrieve: async (subscriptionId: string) => ({
      id: subscriptionId,
      customer: "cus_test_123",
      status: "active",
      current_period_end: Math.floor(NOW.getTime() / 1000) + 30 * 86_400,
    }),
  },
  billingPortal: {
    sessions: {
      create: async () => ({ url: "https://billing.stripe.test/portal" }),
    },
  },
};

function ports() {
  return testPorts({
    clock: fixedClock(NOW),
    stripeClient: fakeStripe,
    subscriptionPriceId: PRICE,
    subscriptionEnabled: true,
  });
}

async function seed() {
  const s = await import("@/db/schema");
  await db.insert(s.user).values([
    { id: "u1", name: "Alice", email: "alice@example.com" },
    { id: "u2", name: "Bob", email: "bob@example.com" },
  ]);
  await db.insert(s.office).values({ id: "o1", name: "Cab", slug: "cab" });
  await db.insert(s.member).values([
    { id: "m1", officeId: "o1", userId: "u1", role: "owner", active: true },
    { id: "m2", officeId: "o1", userId: "u2", role: "practitioner", active: true },
  ]);
  await db.insert(s.practitioner).values([
    { id: "p1", officeId: "o1", userId: "u1", displayName: "Alice", slug: "alice" },
    { id: "p2", officeId: "o1", userId: "u2", displayName: "Bob", slug: "bob" },
  ]);
}

beforeEach(async () => {
  db = createMemoryDb();
  setConnection(db);
  checkoutCalls = [];
  customerCreates = [];
  await seed();
});

describe("billing", () => {
  it("statut initial : inactif, owner détecté", async () => {
    const status = await getBillingStatus(ports(), "u1");
    expect(status).toMatchObject({ enabled: true, active: false, isOwner: true, status: null });
    const other = await getBillingStatus(ports(), "u2");
    expect(other.isOwner).toBe(false);
  });

  it("start crée le customer une fois puis le checkout subscription", async () => {
    const first = await startSubscriptionCheckout(ports(), "u1");
    expect(first.url).toBe("https://checkout.stripe.test/sub/cs_sub_123");
    const second = await startSubscriptionCheckout(ports(), "u1");
    expect(second.url).toBe(first.url);
    expect(customerCreates).toHaveLength(1);

    const params = checkoutCalls[0] as Record<string, unknown>;
    expect(params).toMatchObject({ mode: "subscription", customer: "cus_test_123" });
    expect(params.line_items).toMatchObject([{ price: PRICE, quantity: 1 }]);
    expect((params.metadata as { officeId: string }).officeId).toBe("o1");
  });

  it("start émet subscription-checkout-started", async () => {
    const tracked: { event: AnalyticsEventName; data?: AnalyticsData }[] = [];
    const watched = testPorts({
      clock: fixedClock(NOW),
      stripeClient: fakeStripe,
      subscriptionPriceId: PRICE,
      subscriptionEnabled: true,
      analytics: { track: async (event, data) => void tracked.push({ event, data }) },
    });
    await startSubscriptionCheckout(watched, "u1");
    expect(tracked.map((entry) => entry.event)).toEqual([
      ANALYTICS_EVENTS.SUBSCRIPTION_CHECKOUT_STARTED,
    ]);
  });

  it("start refusé aux non-owners", async () => {
    await expect(startSubscriptionCheckout(ports(), "u2")).rejects.toBeInstanceOf(ForbiddenError);
    expect(checkoutCalls).toHaveLength(0);
  });

  it("start sans prix configuré → 400 propre", async () => {
    const noPrice = testPorts({
      clock: fixedClock(NOW),
      stripeClient: fakeStripe,
      subscriptionEnabled: true,
    });
    await expect(startSubscriptionCheckout(noPrice, "u1")).rejects.toBeInstanceOf(ValidationError);
  });

  it("portail : sans customer → 400, avec customer → url", async () => {
    await expect(createPortalSession(ports(), "u1")).rejects.toBeInstanceOf(ValidationError);
    await startSubscriptionCheckout(ports(), "u1");
    const out = await createPortalSession(ports(), "u1");
    expect(out.url).toBe("https://billing.stripe.test/portal");
  });

  it("webhook subscription rattache et active le cabinet", async () => {
    await startSubscriptionCheckout(ports(), "u1");
    const applied = await applySubscriptionEvent({
      id: "sub_123",
      customer: "cus_test_123",
      status: "active",
      current_period_end: Math.floor(NOW.getTime() / 1000) + 30 * 86_400,
    });
    expect(applied).toBe(true);
    const status = await getBillingStatus(ports(), "u1");
    expect(status).toMatchObject({ active: true, status: "active" });
    expect(status.currentPeriodEnd).not.toBeNull();
  });

  it("webhook customer inconnu → ignoré", async () => {
    await expect(
      applySubscriptionEvent({ id: "sub_x", customer: "cus_nope", status: "active", current_period_end: 0 }),
    ).resolves.toBe(false);
  });

  it("checkout terminé : cabinet inconnu → ignoré, connu → rattaché", async () => {
    await expect(
      handleSubscriptionCheckout({ officeId: "nope", customerId: "cus_a", subscriptionId: "sub_a" }),
    ).resolves.toBe(false);
    await expect(
      handleSubscriptionCheckout({ officeId: "o1", customerId: "cus_test_123", subscriptionId: "sub_123" }),
    ).resolves.toBe(true);
  });

  it("refresh synchronise le statut depuis Stripe", async () => {
    await handleSubscriptionCheckout({ officeId: "o1", customerId: "cus_test_123", subscriptionId: "sub_123" });
    const status = await refreshBillingStatus(ports(), "u1");
    expect(status).toMatchObject({ active: true, status: "active" });
  });

  it("flag désactivé : statut masqué, checkout/portail/refresh refusés", async () => {
    const off = testPorts({
      clock: fixedClock(NOW),
      stripeClient: fakeStripe,
      subscriptionPriceId: PRICE,
    });
    const status = await getBillingStatus(off, "u1");
    expect(status.enabled).toBe(false);
    await expect(startSubscriptionCheckout(off, "u1")).rejects.toBeInstanceOf(ValidationError);
    await expect(createPortalSession(off, "u1")).rejects.toBeInstanceOf(ValidationError);
    await expect(refreshBillingStatus(off, "u1")).rejects.toBeInstanceOf(ValidationError);
    expect(checkoutCalls).toHaveLength(0);
  });
});
