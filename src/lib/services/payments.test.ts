import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDb } from "@/test/memory-db";
import type { Db } from "@/dal/types";
import {
  applyPaymentCompleted,
  createBooking,
  releaseExpiredPendings,
} from "@/lib/services/bookings";
import { ValidationError } from "@/lib/services/errors";
import type { OutgoingEmail } from "@/lib/email";

let db: Db;
let sent: OutgoingEmail[];
let stripeCalls: unknown[];

const NOW = new Date("2026-09-14T06:00:00Z");
const SLOT = "2026-09-14T08:00:00.000Z"; // 10h Paris

const fakeStripe = {
  checkout: {
    sessions: {
      create: async (params: unknown) => {
        stripeCalls.push(params);
        return { id: "cs_test_123", url: "https://checkout.stripe.test/pay/cs_test_123" };
      },
    },
  },
};

function deps(extra = {}) {
  return {
    db,
    now: NOW,
    sendEmail: async (e: OutgoingEmail) => void sent.push(e),
    stripeClient: fakeStripe,
    ...extra,
  };
}

async function seed() {
  const s = await import("@/db/schema");
  await db.insert(s.user).values([{ id: "u1", name: "Alice", email: "alice@example.com" }]);
  await db.insert(s.office).values({ id: "o1", name: "Cab", slug: "cab" });
  await db.insert(s.room).values([{ id: "room-a", officeId: "o1", name: "Salle A" }]);
  await db.insert(s.practitioner).values([
    { id: "p1", officeId: "o1", userId: "u1", displayName: "Alice", slug: "alice" },
  ]);
  await db.insert(s.sessionType).values([
    { id: "stFree", practitionerId: "p1", name: "Gratuit", durationMin: 60, bufferAfterMin: 0 },
    { id: "stPaid", practitionerId: "p1", name: "Payant", durationMin: 60, bufferAfterMin: 0, requiresPayment: true, priceCents: 6000, currency: "eur" },
    { id: "stPaidVal", practitionerId: "p1", name: "Payant + validation", durationMin: 60, bufferAfterMin: 0, requiresPayment: true, priceCents: 6000, currency: "eur", requiresValidation: true },
    { id: "stBroken", practitionerId: "p1", name: "Mal configuré", durationMin: 60, bufferAfterMin: 0, requiresPayment: true },
  ]);
  await db.insert(s.availabilityRule).values([
    { id: "r1", practitionerId: "p1", weekday: 1, startTime: "09:00", endTime: "13:00", roomId: "room-a" },
  ]);
}

const patient = {
  patientFirstName: "Jean",
  patientLastName: "Dupont",
  patientEmail: "jean@example.com",
  consent: true,
};

beforeEach(async () => {
  db = createMemoryDb();
  sent = [];
  stripeCalls = [];
  await seed();
});

describe("paid booking", () => {
  it("crée un pending + session Stripe, sans email", async () => {
    const res = await createBooking(deps(), {
      practitionerSlug: "alice", sessionTypeId: "stPaid", startAt: SLOT, ...patient,
    });
    expect(res.status).toBe("pending");
    expect(res.requiresPayment).toBe(true);
    expect(res.checkoutUrl).toBe("https://checkout.stripe.test/pay/cs_test_123");
    expect(sent).toHaveLength(0);

    const params = stripeCalls[0] as Record<string, unknown>;
    const lineItems = (params.line_items as { price_data: { unit_amount: number; currency: string } }[]);
    expect(lineItems[0].price_data).toMatchObject({ unit_amount: 6000, currency: "eur" });
    expect((params.metadata as { bookingId: string }).bookingId).toBe(res.id);
  });

  it("un pending bloque le créneau comme un confirmé", async () => {
    await createBooking(deps(), {
      practitionerSlug: "alice", sessionTypeId: "stPaid", startAt: SLOT, ...patient,
    });
    const { ConflictError } = await import("@/lib/services/errors");
    await expect(
      createBooking(deps(), {
        practitionerSlug: "alice", sessionTypeId: "stFree", startAt: SLOT,
        ...patient, patientEmail: "autre@example.com",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuse si Stripe n'est pas configuré", async () => {
    await expect(
      createBooking({ db, now: NOW, sendEmail: async () => {} }, {
        practitionerSlug: "alice", sessionTypeId: "stPaid", startAt: SLOT, ...patient,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuse un type payant sans prix", async () => {
    await expect(
      createBooking(deps(), {
        practitionerSlug: "alice", sessionTypeId: "stBroken", startAt: SLOT, ...patient,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("applyPaymentCompleted", () => {
  it("confirme + envoie la confirmation (idempotent)", async () => {
    await createBooking(deps(), {
      practitionerSlug: "alice", sessionTypeId: "stPaid", startAt: SLOT, ...patient,
    });
    const first = await applyPaymentCompleted(deps(), {
      stripeSessionId: "cs_test_123", paymentIntentId: "pi_123",
    });
    expect(first).toEqual({ applied: true, confirmed: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain("Confirmation");

    const second = await applyPaymentCompleted(deps(), {
      stripeSessionId: "cs_test_123", paymentIntentId: "pi_123",
    });
    expect(second).toEqual({ applied: false, confirmed: false });
    expect(sent).toHaveLength(1);
  });

  it("session inconnue → ignoré (pas d'erreur, pas de retry auto)", async () => {
    await expect(
      applyPaymentCompleted(deps(), { stripeSessionId: "cs_nope", paymentIntentId: null }),
    ).resolves.toEqual({ applied: false, confirmed: false });
  });

  it("payé + validation requise → reste pending + email de réception", async () => {
    const res = await createBooking(deps(), {
      practitionerSlug: "alice", sessionTypeId: "stPaidVal", startAt: SLOT, ...patient,
    });
    expect(res.status).toBe("pending");
    const out = await applyPaymentCompleted(deps(), {
      stripeSessionId: "cs_test_123", paymentIntentId: "pi_123",
    });
    expect(out).toEqual({ applied: true, confirmed: false });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain("Paiement reçu");
  });
});

describe("releaseExpiredPendings", () => {
  it("annule les pendings expirés, garde les autres", async () => {
    const s = await import("@/db/schema");
    const old = new Date(NOW.getTime() - 60_000);
    const future = new Date(NOW.getTime() + 60_000);
    await db.insert(s.booking).values([
      {
        id: "exp1", officeId: "o1", practitionerId: "p1", roomId: "room-a", sessionTypeId: "stPaid",
        sessionNameSnapshot: "Payant", durationMinSnapshot: 60, bufferAfterMinSnapshot: 0,
        startAt: new Date("2026-09-20T07:00:00Z"), endAt: new Date("2026-09-20T08:00:00Z"),
        patientFirstName: "J", patientLastName: "D", patientEmail: "j@example.com",
        status: "pending", paymentStatus: "pending", pendingExpiresAt: old,
        cancelToken: "c1", rescheduleToken: "r1",
      },
      {
        id: "ok1", officeId: "o1", practitionerId: "p1", roomId: "room-a", sessionTypeId: "stPaid",
        sessionNameSnapshot: "Payant", durationMinSnapshot: 60, bufferAfterMinSnapshot: 0,
        startAt: new Date("2026-09-20T07:00:00Z"), endAt: new Date("2026-09-20T08:00:00Z"),
        patientFirstName: "J", patientLastName: "D", patientEmail: "j@example.com",
        status: "pending", paymentStatus: "pending", pendingExpiresAt: future,
        cancelToken: "c2", rescheduleToken: "r2",
      },
    ]);
    const n = await releaseExpiredPendings(deps());
    expect(n).toBe(1);
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(s.booking).where(eq(s.booking.id, "exp1"));
    expect(rows[0].status).toBe("cancelled");
    const kept = await db.select().from(s.booking).where(eq(s.booking.id, "ok1"));
    expect(kept[0].status).toBe("pending");
  });
});
