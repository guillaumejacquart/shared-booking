import { beforeEach, describe, expect, it, vi } from "vitest";

import { eq } from "drizzle-orm";
import { createMemoryDb } from "@/test/memory-db";
import { setConnection } from "@/dal/connection";
import type { Db } from "@/dal/types";
import { fixedClock } from "@/lib/ports";
import { verifyConnectState, signConnectState } from "@/lib/stripe-oauth";
import { ANALYTICS_EVENTS, type AnalyticsData, type AnalyticsEventName } from "@/lib/analytics";
import { testPorts } from "@/test/ports";
import {
  completeStandardOAuth,
  disconnectConnect,
  getConnectStatus,
  refreshConnectStatus,
  startConnectOnboarding,
  startStandardOAuth,
} from "./stripe-connect";

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
  oauth: {
    token: async () => ({ stripe_user_id: "acct_oauth_123" }),
    deauthorize: async () => ({}),
  },
};

let tracked: { event: AnalyticsEventName; data?: AnalyticsData }[];

function watchedPorts() {
  return testPorts({
    clock: fixedClock(NOW),
    stripeClient: fakeStripe,
    subscriptionEnabled: true,
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

describe("stripe-connect standard (OAuth, compte existant)", () => {
  const oauth = { clientId: "ca_test_123", stateSecret: "test-state-secret-32-chars-min" };

  function oauthPorts(stripeOverrides = {}) {
    return testPorts({
      clock: fixedClock(NOW),
      stripeClient: { ...fakeStripe, ...stripeOverrides },
      stripeOAuth: oauth,
      subscriptionEnabled: true,
      analytics: { track: async (event, data) => void tracked.push({ event, data }) },
    });
  }

  function stateFor(practitionerId: string): string {
    return signConnectState(practitionerId, oauth.stateSecret, NOW.getTime());
  }

  it("démarrage : URL OAuth avec state rattaché au praticien", async () => {
    const { url } = await startStandardOAuth(oauthPorts(), "u1");
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://connect.stripe.com/oauth/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("ca_test_123");
    const state = parsed.searchParams.get("state") as string;
    expect(verifyConnectState(state, oauth.stateSecret, NOW.getTime())).toBe("p1");
  });

  it("démarrage refusé : OAuth non configuré ou compte déjà lié", async () => {
    await expect(startStandardOAuth(watchedPorts(), "u1")).rejects.toThrow("STRIPE_CLIENT_ID");
    const ports = oauthPorts();
    await startConnectOnboarding(ports, "u1");
    await expect(startStandardOAuth(ports, "u1")).rejects.toThrow("déjà lié");
  });

  it("callback : lie le compte existant en Standard", async () => {
    const ports = oauthPorts();
    const { url } = await startStandardOAuth(ports, "u1");
    const state = new URL(url).searchParams.get("state") as string;
    const status = await completeStandardOAuth(ports, { code: "ac_test", state }, "u1");
    expect(status.accountId).toBe("acct_oauth_123");
    expect(status.accountType).toBe("standard");
    const s = await import("@/db/schema");
    const rows = await db.select().from(s.practitioner).where(eq(s.practitioner.id, "p1"));
    expect(rows[0]?.stripeAccountType).toBe("standard");
    expect(tracked.map((entry) => entry.event)).toEqual([ANALYTICS_EVENTS.STRIPE_CONNECT_STARTED]);
  });

  it("callback : state falsifié, expiré ou d'un autre praticien → refus", async () => {
    const ports = oauthPorts();
    const { url } = await startStandardOAuth(ports, "u1");
    const state = new URL(url).searchParams.get("state") as string;
    await expect(completeStandardOAuth(ports, { code: "ac", state: state + "x" }, "u1")).rejects.toThrow(
      "invalide",
    );
    const other = stateFor("pX");
    await expect(completeStandardOAuth(ports, { code: "ac", state: other }, "u1")).rejects.toThrow("invalide");
  });

  it("callback : échange du code refusé → erreur claire, rien en base", async () => {
    const ports = oauthPorts({ oauth: { token: async () => { throw new Error("bad code"); } } });
    const { url } = await startStandardOAuth(ports, "u1");
    const state = new URL(url).searchParams.get("state") as string;
    await expect(completeStandardOAuth(ports, { code: "ac_bad", state }, "u1")).rejects.toThrow("Échange OAuth");
    const s = await import("@/db/schema");
    const rows = await db.select().from(s.practitioner);
    expect(rows[0]?.stripeAccountId).toBeNull();
  });

  it("callback rejoué : resynchronise sans doublon", async () => {
    const ports = oauthPorts();
    const { url } = await startStandardOAuth(ports, "u1");
    const state = new URL(url).searchParams.get("state") as string;
    await completeStandardOAuth(ports, { code: "ac_test", state }, "u1");
    tracked.length = 0;
    const again = await completeStandardOAuth(ports, { code: "ac_test", state }, "u1");
    expect(again.accountId).toBe("acct_oauth_123");
    expect(tracked).toHaveLength(0);
  });

  it("statut : expose oauthEnabled et accountType", async () => {
    expect((await getConnectStatus(oauthPorts(), "u1")).oauthEnabled).toBe(true);
    expect((await getConnectStatus(watchedPorts(), "u1")).oauthEnabled).toBe(false);
    const ports = oauthPorts();
    const { url } = await startStandardOAuth(ports, "u1");
    const state = new URL(url).searchParams.get("state") as string;
    await completeStandardOAuth(ports, { code: "ac", state }, "u1");
    expect((await getConnectStatus(ports, "u1")).accountType).toBe("standard");
  });

  it("déconnexion Standard : révoque côté Stripe ; Express : pas de deauthorize", async () => {
    const deauthorize = vi.fn(async () => ({}));
    const ports = oauthPorts({ oauth: { token: async () => ({ stripe_user_id: "acct_oauth_123" }), deauthorize } });
    const { url } = await startStandardOAuth(ports, "u1");
    const state = new URL(url).searchParams.get("state") as string;
    await completeStandardOAuth(ports, { code: "ac", state }, "u1");
    await disconnectConnect(ports, "u1");
    expect(deauthorize).toHaveBeenCalledWith({ client_id: "ca_test_123", stripe_user_id: "acct_oauth_123" });
    const s = await import("@/db/schema");
    const rows = await db.select().from(s.practitioner);
    expect(rows[0]?.stripeAccountId).toBeNull();

    deauthorize.mockClear();
    await startConnectOnboarding(ports, "u1");
    await disconnectConnect(ports, "u1");
    expect(deauthorize).not.toHaveBeenCalled();
  });

  it("flag paiement off : liaison Express et Standard refusées", async () => {
    const off = testPorts({ clock: fixedClock(NOW), stripeClient: fakeStripe, stripeOAuth: oauth });
    expect((await getConnectStatus(off, "u1")).paymentsEnabled).toBe(false);
    await expect(startConnectOnboarding(off, "u1")).rejects.toThrow("SUBSCRIPTION_ENABLED");
    await expect(startStandardOAuth(off, "u1")).rejects.toThrow("SUBSCRIPTION_ENABLED");
  });

  it("clé restreinte sans droit Connect : message actionnable", async () => {
    const denied = { type: "StripePermissionError", raw: { code: "more_permissions_required" } };
    const ports = oauthPorts({
      accounts: { create: async () => { throw denied; }, retrieve: fakeStripe.accounts.retrieve },
    });
    await expect(startConnectOnboarding(ports, "u1")).rejects.toThrow("connected_account_write");
  });
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
