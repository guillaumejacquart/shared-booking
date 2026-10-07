import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDb } from "@/test/memory-db";
import { setConnection } from "@/dal/connection";
import type { Db } from "@/dal/types";
import { fixedClock } from "@/lib/ports";
import { testPorts } from "@/test/ports";
import { ValidationError } from "./errors";
import {
  disconnectConnect,
  getConnectStatus,
  handleAccountUpdated,
  refreshConnectStatus,
  startConnectOnboarding,
} from "./stripe-connect";

let db: Db;
let accountCreates: unknown[];
let linkCreates: unknown[];
let retrieveResult = { id: "acct_test_123", charges_enabled: false, payouts_enabled: false };

const NOW = new Date("2026-09-14T06:00:00Z");

const fakeStripe = {
  checkout: { sessions: { create: async () => ({ id: "cs_x", url: "https://x" }) } },
  accounts: {
    create: async (params: unknown) => {
      accountCreates.push(params);
      return { id: "acct_test_123" };
    },
    retrieve: async (accountId: string) => ({ ...retrieveResult, id: accountId }),
  },
  accountLinks: {
    create: async (params: unknown) => {
      linkCreates.push(params);
      return { url: "https://connect.stripe.test/onboarding" };
    },
  },
  customers: {
    create: async () => ({ id: "cus_test_123" }),
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
  return testPorts({ clock: fixedClock(NOW), stripeClient: fakeStripe });
}

async function seed() {
  const s = await import("@/db/schema");
  await db.insert(s.user).values([{ id: "u1", name: "Alice", email: "alice@example.com" }]);
  await db.insert(s.office).values({ id: "o1", name: "Cab", slug: "cab" });
  await db.insert(s.practitioner).values([
    { id: "p1", officeId: "o1", userId: "u1", displayName: "Alice", slug: "alice" },
  ]);
}

beforeEach(async () => {
  db = createMemoryDb();
  setConnection(db);
  accountCreates = [];
  linkCreates = [];
  retrieveResult = { id: "acct_test_123", charges_enabled: false, payouts_enabled: false };
  await seed();
});

describe("stripe connect", () => {
  it("statut initial : non lié, pas prêt", async () => {
    const status = await getConnectStatus("u1");
    expect(status).toMatchObject({ accountId: null, ready: false });
  });

  it("start crée le compte + lien d'onboarding et stocke acct", async () => {
    const out = await startConnectOnboarding(ports(), "u1");
    expect(out).toMatchObject({
      accountId: "acct_test_123",
      url: "https://connect.stripe.test/onboarding",
    });
    expect(accountCreates).toHaveLength(1);
    expect(linkCreates).toHaveLength(1);
    expect((linkCreates[0] as Record<string, unknown>).account).toBe("acct_test_123");
    const status = await getConnectStatus("u1");
    expect(status.accountId).toBe("acct_test_123");
    expect(status.ready).toBe(false);
  });

  it("start réutilise le compte existant (pas de 2e création)", async () => {
    await startConnectOnboarding(ports(), "u1");
    await startConnectOnboarding(ports(), "u1");
    expect(accountCreates).toHaveLength(1);
    expect(linkCreates).toHaveLength(2);
  });

  it("refresh synchronise les flags depuis Stripe", async () => {
    await startConnectOnboarding(ports(), "u1");
    retrieveResult = { id: "acct_test_123", charges_enabled: true, payouts_enabled: true };
    const status = await refreshConnectStatus(ports(), "u1");
    expect(status).toMatchObject({ ready: true, chargesEnabled: true, payoutsEnabled: true });
  });

  it("webhook account.updated met à jour le bon praticien", async () => {
    await startConnectOnboarding(ports(), "u1");
    const applied = await handleAccountUpdated({
      id: "acct_test_123",
      charges_enabled: true,
      payouts_enabled: false,
    });
    expect(applied).toBe(true);
    const status = await getConnectStatus("u1");
    expect(status).toMatchObject({ chargesEnabled: true, payoutsEnabled: false, ready: true });
  });

  it("webhook compte inconnu → ignoré", async () => {
    await expect(
      handleAccountUpdated({ id: "acct_nope", charges_enabled: true, payouts_enabled: true }),
    ).resolves.toBe(false);
  });

  it("disconnect délie le compte", async () => {
    await startConnectOnboarding(ports(), "u1");
    const status = await disconnectConnect("u1");
    expect(status).toMatchObject({ accountId: null, ready: false });
  });

  it("start sans client Stripe → 400 propre", async () => {
    const noStripe = testPorts({ clock: fixedClock(NOW) });
    await expect(startConnectOnboarding(noStripe, "u1")).rejects.toBeInstanceOf(ValidationError);
  });
});
