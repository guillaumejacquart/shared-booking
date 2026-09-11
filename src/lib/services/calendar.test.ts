import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDb } from "@/test/memory-db";
import type { Db } from "@/dal/types";
import { getAgendaEvents, getSharedCalendar } from "@/lib/services/calendar";
import { ForbiddenError, NotFoundError } from "@/lib/services/errors";

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
  await db.insert(s.room).values([{ id: "room-a", officeId: "o1", name: "Salle A" }]);
  await db.insert(s.sessionType).values([
    { id: "st1", practitionerId: "p1", name: "Séance", durationMin: 60, bufferAfterMin: 0 },
  ]);
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
      status: "confirmed",
      paymentStatus: "none",
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
  db = createMemoryDb();
  await seed();
});

describe("getAgendaEvents", () => {
  it("retourne les RDV du praticien connecté", async () => {
    const { events } = await getAgendaEvents({ tx: db }, { userId: "u1", start: START, end: END });
    expect(events).toHaveLength(1);
    expect(events[0].title).toContain("Jean Dupont");
  });

  it("404 si pas de praticien", async () => {
    await expect(
      getAgendaEvents({ tx: db }, { userId: "nobody", start: START, end: END }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("getSharedCalendar", () => {
  it("le owner voit les noms des patients de tous", async () => {
    const cal = await getSharedCalendar({ tx: db }, { userId: "u1", start: START, end: END });
    expect(cal.events).toHaveLength(2);
    expect(cal.events.map((e) => e.title)).toEqual(
      expect.arrayContaining(["Séance — Jean Dupont", "Séance — Marie Martin"]),
    );
  });

  it("un praticien non-owner voit 'Réservé' pour les autres", async () => {
    const cal = await getSharedCalendar({ tx: db }, { userId: "u2", start: START, end: END });
    const alice = cal.events.find((e) => e.id === "b1")!;
    const bob = cal.events.find((e) => e.id === "b2")!;
    expect(alice.title).toBe("Réservé");
    expect(alice.extendedProps.patientName).toBeNull();
    expect(bob.title).toContain("Marie Martin");
  });

  it("403 si pas membre du cabinet", async () => {
    const s = await import("@/db/schema");
    await db.insert(s.user).values([{ id: "u9", name: "Zoe", email: "zoe@example.com" }]);
    await db.insert(s.practitioner).values([
      { id: "p9", officeId: "o1", userId: "u9", displayName: "Zoe", slug: "zoe" },
    ]);
    await expect(
      getSharedCalendar({ tx: db }, { userId: "u9", start: START, end: END }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
