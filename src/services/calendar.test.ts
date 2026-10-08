import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDb } from "@/test/memory-db";
import { seedSingleVariant } from "@/test/session-types";
import { setConnection } from "@/dal/connection";
import type { Db } from "@/dal/types";
import { getReservations, getSharedCalendar } from "@/services/calendar";
import { ForbiddenError, NotFoundError } from "@/services/errors";

let db: Db;
const START = new Date("2026-09-14T00:00:00Z");
const END = new Date("2026-09-15T00:00:00Z");

async function seed() {
  const s = await import("@/db/schema");
  await db.insert(s.user).values([
    { id: "u1", name: "Alice", email: "alice@example.com" },
    { id: "u2", name: "Bob", email: "bob@example.com" },
  ]);
  await db.insert(s.office).values([{ id: "o1", name: "Cab", slug: "cab" }]);
  await db.insert(s.member).values([
    { id: "m1", officeId: "o1", userId: "u1", role: "owner" },
    { id: "m2", officeId: "o1", userId: "u2", role: "practitioner" },
  ]);
  await db.insert(s.practitioner).values([
    { id: "p1", officeId: "o1", userId: "u1", displayName: "Alice", slug: "alice" },
    { id: "p2", officeId: "o1", userId: "u2", displayName: "Bob", slug: "bob" },
  ]);
  await db.insert(s.room).values([
    { id: "room-a", officeId: "o1", name: "Salle A" },
    { id: "room-x", officeId: "o1", name: "Exclusive" },
  ]);
  // Salle A ouverte à tous ; Exclusive réservée à Alice.
  await db.insert(s.roomMember).values([{ id: "rm1", roomId: "room-x", practitionerId: "p1" }]);
  await seedSingleVariant(db, { id: "st1", practitionerId: "p1", name: "Séance", durationMin: 60, bufferAfterMin: 0 });
  await db.insert(s.booking).values([
    {
      id: "b1",
      officeId: "o1",
      practitionerId: "p1",
      roomId: "room-a",
      sessionTypeId: "st1",
      sessionNameSnapshot: "Séance",
      durationMinSnapshot: 60,
      bufferAfterMinSnapshot: 0,
      startAt: new Date("2026-09-14T08:00:00Z"),
      endAt: new Date("2026-09-14T09:00:00Z"),
      patientFirstName: "Jean",
      patientLastName: "Dupont",
      patientEmail: "jean@example.com",
      patientPhone: "0600000001",
      notes: "Préfère le matin",
      status: "confirmed",
      paymentStatus: "paid",
      cancelToken: "ct1",
      rescheduleToken: "rt1",
    },
    {
      id: "b2",
      officeId: "o1",
      practitionerId: "p2",
      roomId: "room-a",
      sessionTypeId: "st1",
      sessionNameSnapshot: "Séance",
      durationMinSnapshot: 60,
      bufferAfterMinSnapshot: 0,
      startAt: new Date("2026-09-14T10:00:00Z"),
      endAt: new Date("2026-09-14T11:00:00Z"),
      patientFirstName: "Marie",
      patientLastName: "Martin",
      patientEmail: "marie@example.com",
      status: "confirmed",
      paymentStatus: "none",
      cancelToken: "ct2",
      rescheduleToken: "rt2",
    },
  ]);
}

beforeEach(async () => {
  db = createMemoryDb();  setConnection(db);  setConnection(db);
  await seed();
});

describe("getSharedCalendar", () => {
  it("chacun ne voit les noms que de ses propres patients (y compris le owner)", async () => {
    const cal = await getSharedCalendar({ userId: "u1", start: START, end: END });
    expect(cal.events).toHaveLength(2);
    const mine = cal.events.find((e) => e.id === "b1")!;
    const other = cal.events.find((e) => e.id === "b2")!;
    expect(mine.title).toBe("Séance — Jean Dupont");
    expect(other.title).toBe("Réservé");
    expect(other.extendedProps.patientName).toBeNull();
  });

  it("un praticien non-owner voit 'Réservé' pour les autres", async () => {
    const cal = await getSharedCalendar({ userId: "u2", start: START, end: END });
    const alice = cal.events.find((e) => e.id === "b1")!;
    const bob = cal.events.find((e) => e.id === "b2")!;
    expect(alice.title).toBe("Réservé");
    expect(alice.extendedProps.patientName).toBeNull();
    expect(bob.title).toContain("Marie Martin");
  });

  it("notes, paiement et gestion visibles pour soi uniquement, masqués pour les autres", async () => {
    const owner = await getSharedCalendar({ userId: "u1", start: START, end: END });
    const bob = owner.events.find((e) => e.id === "b2")!;
    // RDV d'autrui : masqué même pour le owner, sans lien de gestion.
    expect(bob.extendedProps.patientEmail).toBeNull();
    expect(bob.extendedProps.cancelToken).toBeNull();

    const alice = (await getSharedCalendar({ userId: "u1", start: START, end: END })).events.find(
      (e) => e.id === "b1",
    )!;
    expect(alice.extendedProps.notes).toBe("Préfère le matin");
    expect(alice.extendedProps.paymentStatus).toBe("paid");
    expect(alice.extendedProps.cancelToken).toBe("ct1");

    const other = await getSharedCalendar({ userId: "u2", start: START, end: END });
    const masked = other.events.find((e) => e.id === "b1")!;
    expect(masked.extendedProps.patientEmail).toBeNull();
    expect(masked.extendedProps.patientPhone).toBeNull();
    expect(masked.extendedProps.notes).toBeNull();
    expect(masked.extendedProps.paymentStatus).toBeNull();
    expect(masked.extendedProps.cancelToken).toBeNull();
    // … mais ses propres données restent complètes.
    const mine = other.events.find((e) => e.id === "b2")!;
    expect(mine.extendedProps.paymentStatus).toBe("none");
    expect(mine.extendedProps.cancelToken).toBe("ct2");
  });

  it("la couleur des événements suit le statut du RDV", async () => {
    const cal = await getSharedCalendar({ userId: "u1", start: START, end: END });
    const confirmed = cal.events.find((e) => e.id === "b1")!;
    expect(confirmed.backgroundColor).toBe("var(--brand-soft)");
    expect(confirmed.textColor).toBe("var(--brand-deep)");
  });

  it("403 si pas membre du cabinet", async () => {
    const s = await import("@/db/schema");
    await db.insert(s.user).values([{ id: "u9", name: "Zoe", email: "zoe@example.com" }]);
    await db.insert(s.practitioner).values([
      { id: "p9", officeId: "o1", userId: "u9", displayName: "Zoe", slug: "zoe" },
    ]);
    await expect(
      getSharedCalendar({ userId: "u9", start: START, end: END }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("getReservations", () => {
  it("sépare demandes à valider et confirmées à venir, triées par horaire", async () => {
    const schema = await import("@/db/schema");
    await db.insert(schema.booking).values([
      {
        id: "b3",
        officeId: "o1",
        practitionerId: "p1",
        roomId: "room-a",
        sessionTypeId: "st1",
        sessionNameSnapshot: "Séance",
        durationMinSnapshot: 60,
        bufferAfterMinSnapshot: 0,
        startAt: new Date("2026-09-14T12:00:00Z"),
        endAt: new Date("2026-09-14T13:00:00Z"),
        patientFirstName: "Paul",
        patientLastName: "Durand",
        patientEmail: "paul@example.com",
        status: "pending",
        paymentStatus: "none",
        validationRequired: true,
        cancelToken: "ct3",
        rescheduleToken: "rt3",
      },
      {
        id: "b4",
        officeId: "o1",
        practitionerId: "p1",
        roomId: "room-a",
        sessionTypeId: "st1",
        sessionNameSnapshot: "Séance",
        durationMinSnapshot: 60,
        bufferAfterMinSnapshot: 0,
        startAt: new Date("2026-09-13T08:00:00Z"),
        endAt: new Date("2026-09-13T09:00:00Z"),
        patientFirstName: "Vieux",
        patientLastName: "Passé",
        patientEmail: "vieux@example.com",
        status: "confirmed",
        paymentStatus: "none",
        cancelToken: "ct4",
        rescheduleToken: "rt4",
      },
    ]);
    const result = await getReservations({
      userId: "u1",
      now: new Date("2026-09-14T00:00:00Z"),
    });
    // b3 seule demande ; b4 (passé confirmé) exclu des à venir.
    expect(result.pending.map((item) => item.id)).toEqual(["b3"]);
    expect(result.upcoming.map((item) => item.id)).toEqual(["b1"]);
    expect(result.pending[0].roomName).toBe("Salle A");
    expect(result.pending[0].patientName).toBe("Paul Durand");
  });

  it("ignore les autres praticiens et les pendings sans validation", async () => {
    const schema = await import("@/db/schema");
    await db.insert(schema.booking).values({
      id: "b5",
      officeId: "o1",
      practitionerId: "p1",
      roomId: "room-a",
      sessionTypeId: "st1",
      sessionNameSnapshot: "Séance",
      durationMinSnapshot: 60,
      bufferAfterMinSnapshot: 0,
      startAt: new Date("2026-09-14T12:00:00Z"),
      endAt: new Date("2026-09-14T13:00:00Z"),
      patientFirstName: "Paye",
      patientLastName: "PlusTard",
      patientEmail: "paye@example.com",
      status: "pending",
      paymentStatus: "pending",
      validationRequired: false,
      cancelToken: "ct5",
      rescheduleToken: "rt5",
    });
    const result = await getReservations({
      userId: "u2",
      now: new Date("2026-09-14T00:00:00Z"),
    });
    // Bob ne voit que son confirmé ; le pending paiement d'Alice n'apparaît nulle part.
    expect(result.pending).toEqual([]);
    expect(result.upcoming.map((item) => item.id)).toEqual(["b2"]);
  });

  it("404 si pas de praticien", async () => {
    await expect(
      getReservations({ userId: "nobody", now: new Date() }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
