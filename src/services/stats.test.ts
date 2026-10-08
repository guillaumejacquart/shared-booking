import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDb } from "@/test/memory-db";
import { setConnection } from "@/dal/connection";
import type { Booking, Db } from "@/dal/types";
import * as schema from "@/db/schema";
import { fixedClock } from "@/lib/ports";
import { testPorts } from "@/test/ports";
import { seedSingleVariant } from "@/test/session-types";
import { cancelBooking, createBooking } from "@/services/bookings";
import {
  bookingKind,
  computeKpis,
  computeRevenue,
  createStatsService,
  leadDaysOf,
  mondayOf,
  normalizeEmail,
} from "@/services/stats";

const NOW = new Date("2026-09-14T06:00:00Z");

let db: Db;

function makeRow(overrides: Partial<Booking> & { startAt: Date }): Booking {
  return {
    id: crypto.randomUUID(),
    officeId: "o1",
    practitionerId: "p1",
    roomId: "room-a",
    sessionTypeId: null,
    sessionVariantId: null,
    sessionNameSnapshot: "Séance",
    durationMinSnapshot: 60,
    bufferAfterMinSnapshot: 0,
    priceCentsSnapshot: null,
    priceDisplaySnapshot: null,
    currencySnapshot: null,
    endAt: new Date(overrides.startAt.getTime() + 3_600_000),
    patientFirstName: "Jean",
    patientLastName: "Dupont",
    patientEmail: "jean@example.com",
    patientPhone: null,
    notes: null,
    status: "confirmed",
    paymentStatus: "none",
    stripeSessionId: null,
    stripePaymentIntentId: null,
    validationRequired: false,
    validatedAt: null,
    pendingExpiresAt: null,
    cancelToken: `cancel-${Math.random()}`,
    rescheduleToken: `resched-${Math.random()}`,
    reminderSentAt: null,
    cancelledAt: null,
    cancelReason: null,
    cancelledBy: null,
    googleEventId: null,
    googleSyncStatus: "none",
    googleSyncError: null,
    createdAt: new Date("2026-08-01T08:00:00Z"),
    updatedAt: new Date("2026-08-01T08:00:00Z"),
    ...overrides,
  } as Booking;
}

describe("stats pures", () => {
  it("normalise les emails pour nouveau vs revenant", () => {
    expect(normalizeEmail("  Jean@Example.com ")).toBe("jean@example.com");
  });

  it("bookingKind : passé confirmé = honoré, pending exclu du passé", () => {
    expect(bookingKind(makeRow({ status: "confirmed", startAt: new Date("2026-09-13T08:00:00Z") }), NOW)).toBe("honored");
    expect(bookingKind(makeRow({ status: "confirmed", startAt: new Date("2026-09-20T08:00:00Z") }), NOW)).toBe("upcoming");
    expect(bookingKind(makeRow({ status: "completed", startAt: new Date("2026-08-01T08:00:00Z") }), NOW)).toBe("honored");
    expect(bookingKind(makeRow({ status: "cancelled", startAt: new Date("2026-08-01T08:00:00Z") }), NOW)).toBe("cancelled");
    expect(bookingKind(makeRow({ status: "pending", startAt: new Date("2026-08-01T08:00:00Z") }), NOW)).toBe("pending");
  });

  it("leadDaysOf : délai en jours, null si incohérent", () => {
    const row = makeRow({ startAt: new Date("2026-08-04T08:00:00Z"), createdAt: new Date("2026-08-01T08:00:00Z") });
    expect(leadDaysOf(row)).toBe(3);
    expect(leadDaysOf(makeRow({ startAt: new Date("2026-08-01T08:00:00Z"), createdAt: new Date("2026-08-04T08:00:00Z") }))).toBeNull();
  });

  it("mondayOf : ancre au lundi mural", () => {
    expect(mondayOf("2026-08-06")).toBe("2026-08-03"); // jeudi → lundi
    expect(mondayOf("2026-08-03")).toBe("2026-08-03"); // lundi → lui-même
    expect(mondayOf("2026-08-09")).toBe("2026-08-03"); // dimanche → lundi précédent
  });

  it("computeKpis : taux d'annulation hors pending, split annuleurs", () => {
    const kpis = computeKpis([
      { kind: "honored", cancelledBy: null, leadDays: 3, isReturning: true },
      { kind: "honored", cancelledBy: null, leadDays: 5, isReturning: false },
      { kind: "cancelled", cancelledBy: "patient", leadDays: 1, isReturning: false },
      { kind: "cancelled", cancelledBy: "practitioner", leadDays: 2, isReturning: false },
      { kind: "cancelled", cancelledBy: null, leadDays: null, isReturning: false },
      { kind: "pending", cancelledBy: null, leadDays: 4, isReturning: false },
      { kind: "upcoming", cancelledBy: null, leadDays: 10, isReturning: false },
    ]);
    expect(kpis).toMatchObject({
      honored: 2,
      upcoming: 1,
      cancelled: 3,
      pending: 1,
      cancelRate: 60,
      cancelledByPatient: 1,
      cancelledByPractitioner: 1,
      returningRate: 16.7,
      medianLeadDays: 3.5,
    });
  });

  it("computeKpis : taux null sans dénominateur", () => {
    const kpis = computeKpis([]);
    expect(kpis.cancelRate).toBeNull();
    expect(kpis.returningRate).toBeNull();
    expect(kpis.medianLeadDays).toBeNull();
  });

  it("computeRevenue : somme par devise,unknown compté à part", () => {
    const revenue = computeRevenue([
      { kind: "honored", priceCents: 6000, currency: "eur" },
      { kind: "honored", priceCents: 8000, currency: "EUR" },
      { kind: "honored", priceCents: null, currency: null },
      { kind: "cancelled", priceCents: 6000, currency: "eur" },
      { kind: "upcoming", priceCents: 6000, currency: "eur" },
    ]);
    expect(revenue).toEqual({ totals: [{ currency: "eur", cents: 14000 }], unknownPriceCount: 1 });
  });
});

describe("stats service (intégration)", () => {
  async function seedBase() {
    await db.insert(schema.user).values([
      { id: "u1", name: "Alice", email: "alice@example.com" },
      { id: "u2", name: "Bob", email: "bob@example.com" },
    ]);
    await db.insert(schema.office).values({
      id: "o1",
      name: "Cabinet Test",
      slug: "cabinet-test",
      bookingLeadTimeMin: 120,
      cancelDeadlineHours: 24,
      reminderHoursBefore: 24,
      defaultBufferAfterMin: 0,
    });
    await db.insert(schema.room).values({ id: "room-a", officeId: "o1", name: "Salle A", color: "#3b82f6" });
    await db.insert(schema.practitioner).values([
      { id: "p1", officeId: "o1", userId: "u1", displayName: "Alice", slug: "alice", slotStepMin: 15 },
      { id: "p2", officeId: "o1", userId: "u2", displayName: "Bob", slug: "bob", slotStepMin: 15 },
    ]);
    await db.insert(schema.member).values([
      { id: "m1", officeId: "o1", userId: "u1", role: "practitioner" },
      { id: "m2", officeId: "o1", userId: "u2", role: "practitioner" },
    ]);
  }

  beforeEach(async () => {
    db = createMemoryDb();
    setConnection(db);
    await seedBase();
  });

  function statsService() {
    return createStatsService(testPorts({ clock: fixedClock(NOW) }));
  }

  const period = { from: new Date("2026-08-01T00:00:00Z"), to: new Date("2026-09-15T00:00:00Z") };

  async function insertBookingRow(overrides: Partial<Booking> & { startAt: Date }) {
    const row = makeRow(overrides);
    await db.insert(schema.booking).values({
      id: row.id,
      officeId: row.officeId,
      practitionerId: row.practitionerId,
      roomId: row.roomId,
      sessionTypeId: row.sessionTypeId,
      sessionVariantId: row.sessionVariantId,
      sessionNameSnapshot: row.sessionNameSnapshot,
      durationMinSnapshot: row.durationMinSnapshot,
      bufferAfterMinSnapshot: row.bufferAfterMinSnapshot,
      priceCentsSnapshot: row.priceCentsSnapshot,
      currencySnapshot: row.currencySnapshot,
      startAt: row.startAt,
      endAt: row.endAt,
      patientFirstName: row.patientFirstName,
      patientLastName: row.patientLastName,
      patientEmail: row.patientEmail,
      status: row.status,
      cancelledBy: row.cancelledBy,
      cancelToken: row.cancelToken,
      rescheduleToken: row.rescheduleToken,
      createdAt: row.createdAt,
    });
    return row;
  }

  it("getStats : KPIs, CA, revenants, semaines et options", async () => {
    await seedSingleVariant(db, {
      id: "st1",
      practitionerId: "p1",
      name: "Massage",
      durationMin: 60,
      priceDisplay: "60 €",
      priceCents: 6000,
    });
    // Connu avant la période → revenant.
    await insertBookingRow({
      id: "b0",
      status: "completed",
      startAt: new Date("2026-07-10T08:00:00Z"),
      patientEmail: "jean@example.com",
      createdAt: new Date("2026-07-01T08:00:00Z"),
    });
    await insertBookingRow({
      id: "b1",
      sessionTypeId: "st1",
      sessionNameSnapshot: "Massage (60 min)",
      status: "completed",
      startAt: new Date("2026-08-04T08:00:00Z"),
      patientEmail: "jean@example.com",
      priceCentsSnapshot: 6000,
      currencySnapshot: "eur",
      createdAt: new Date("2026-08-01T08:00:00Z"),
    });
    await insertBookingRow({
      id: "b2",
      sessionNameSnapshot: "Suivi",
      status: "cancelled",
      cancelledBy: "patient",
      startAt: new Date("2026-08-11T08:00:00Z"),
      patientEmail: "marie@example.com",
      priceCentsSnapshot: 8000,
      currencySnapshot: "eur",
      createdAt: new Date("2026-08-06T08:00:00Z"),
    });
    await insertBookingRow({
      id: "b3",
      sessionNameSnapshot: "Suivi",
      status: "cancelled",
      cancelledBy: "practitioner",
      startAt: new Date("2026-08-18T08:00:00Z"),
      patientEmail: "paul@example.com",
      createdAt: new Date("2026-08-17T08:00:00Z"),
    });
    await insertBookingRow({
      id: "b4",
      sessionNameSnapshot: "Massage (60 min)",
      status: "confirmed",
      startAt: new Date("2026-09-14T08:00:00Z"),
      patientEmail: "lea@example.com",
      priceCentsSnapshot: 6000,
      currencySnapshot: "eur",
      createdAt: new Date("2026-09-10T08:00:00Z"),
    });
    await insertBookingRow({
      id: "b5",
      sessionNameSnapshot: "Massage (60 min)",
      status: "pending",
      startAt: new Date("2026-09-10T08:00:00Z"),
      patientEmail: "zoe@example.com",
      createdAt: new Date("2026-09-08T08:00:00Z"),
    });
    // Autre praticien : exclu.
    await insertBookingRow({
      id: "b6",
      practitionerId: "p2",
      status: "completed",
      startAt: new Date("2026-08-05T08:00:00Z"),
      patientEmail: "autre@example.com",
    });

    const result = await statsService().getStats({ userId: "u1", ...period });

    expect(result.kpis).toMatchObject({
      honored: 1,
      upcoming: 1,
      cancelled: 2,
      pending: 1,
      cancelRate: 66.7,
      cancelledByPatient: 1,
      cancelledByPractitioner: 1,
      returningRate: 25,
      medianLeadDays: 3,
    });
    expect(result.revenue).toEqual({ totals: [{ currency: "eur", cents: 6000 }], unknownPriceCount: 0 });
    expect(result.weekly).toEqual([
      { weekStart: "2026-08-03", honored: 1, cancelled: 0 },
      { weekStart: "2026-08-10", honored: 0, cancelled: 1 },
      { weekStart: "2026-08-17", honored: 0, cancelled: 1 },
    ]);
    expect(result.bySession).toEqual([
      { name: "Massage (60 min)", count: 2, honored: 1, cancelled: 0, minutes: 120 },
      { name: "Suivi", count: 2, honored: 0, cancelled: 2, minutes: 120 },
    ]);
    expect(result.rows).toHaveLength(5);
    expect(result.rows[0].isReturning).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.options.sessions).toEqual([{ id: "st1", name: "Massage" }]);
    expect(result.options.rooms).toEqual([{ id: "room-a", name: "Salle A" }]);
  });

  it("getStats : filtres statut et séance", async () => {
    await seedSingleVariant(db, {
      id: "st1",
      practitionerId: "p1",
      name: "Massage",
      durationMin: 60,
    });
    await insertBookingRow({
      id: "b1",
      sessionTypeId: "st1",
      status: "completed",
      startAt: new Date("2026-08-04T08:00:00Z"),
    });
    await insertBookingRow({
      id: "b2",
      status: "cancelled",
      cancelledBy: "patient",
      startAt: new Date("2026-08-11T08:00:00Z"),
    });
    const service = statsService();
    const cancelled = await service.getStats({ userId: "u1", ...period, status: "cancelled" });
    expect(cancelled.rows.map((row) => row.id)).toEqual(["b2"]);
    expect(cancelled.kpis.honored).toBe(0);
    const bySession = await service.getStats({ userId: "u1", ...period, sessionTypeId: "st1" });
    expect(bySession.rows.map((row) => row.id)).toEqual(["b1"]);
  });

  it("getStats : garde-fous période et praticien", async () => {
    const service = statsService();
    await expect(service.getStats({ userId: "u1", from: period.to, to: period.from })).rejects.toThrow("Période invalide");
    await expect(
      service.getStats({ userId: "u1", from: period.from, to: new Date("2028-01-01T00:00:00Z") }),
    ).rejects.toThrow("Période trop longue");
    await expect(service.getStats({ userId: "inconnu", ...period })).rejects.toThrow("Praticien introuvable");
  });

  it("createBooking fige les snapshots tarifaires, cancel trace l'auteur", async () => {
    await db.insert(schema.availabilityRule).values([
      { id: "r1", practitionerId: "p1", weekday: 1, startTime: "09:00", endTime: "13:00" },
    ]);
    await seedSingleVariant(db, {
      id: "st1",
      practitionerId: "p1",
      name: "Massage",
      durationMin: 60,
      bufferAfterMin: 10,
      priceDisplay: "60 €",
      priceCents: 6000,
    });
    const ports = testPorts({ clock: fixedClock(NOW), sendEmail: async () => {} });
    const first = await createBooking(ports, {
      practitionerSlug: "alice",
      sessionTypeId: "st1",
      startAt: "2026-09-21T08:15:00.000Z",
      patientFirstName: "Jean",
      patientLastName: "Dupont",
      patientEmail: "JEAN@example.com",
      consent: true,
    });
    const stored = await db.select().from(schema.booking).then((rows) => rows[0]);
    expect(stored.priceCentsSnapshot).toBe(6000);
    expect(stored.priceDisplaySnapshot).toBe("60 €");
    expect(stored.currencySnapshot).toBe("eur");
    expect(stored.patientEmail).toBe("jean@example.com");

    await cancelBooking(ports, { token: first.cancelToken, by: "patient" });
    const afterPatient = await db.select().from(schema.booking).then((rows) => rows[0]);
    expect(afterPatient.cancelledBy).toBe("patient");

    const second = await createBooking(ports, {
      practitionerSlug: "alice",
      sessionTypeId: "st1",
      startAt: "2026-09-21T09:30:00.000Z",
      patientFirstName: "Marie",
      patientLastName: "Martin",
      patientEmail: "marie@example.com",
      consent: true,
    });
    await cancelBooking(ports, { token: second.cancelToken, by: "practitioner", reason: "Imprévu" });
    const afterPrac = await db.select().from(schema.booking).then((rows) => rows.find((row) => row.id === second.id));
    expect(afterPrac?.cancelledBy).toBe("practitioner");
  });
});
