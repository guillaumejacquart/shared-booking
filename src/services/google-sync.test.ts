import { beforeEach, describe, expect, it } from "vitest";

import { setConnection } from "@/dal/connection";
import * as bookingsDal from "@/dal/bookings";
import type { Db } from "@/dal/types";
import { createMemoryDb } from "@/test/memory-db";
import { fixedClock } from "@/lib/ports";
import { testPorts } from "@/test/ports";
import { seedSingleVariant } from "@/test/session-types";
import type { CalendarClient } from "@/lib/google-calendar";
import { buildGoogleEvent, syncBookingToGoogle, syncMany } from "./google-sync";

let db: Db;

function fakeClient(): CalendarClient & {
  calls: { kind: string; calendarId: string; eventId?: string }[];
} {
  const calls: { kind: string; calendarId: string; eventId?: string }[] = [];
  return {
    calls,
    insertEvent: async (calendarId) => {
      calls.push({ kind: "insert", calendarId });
      return { id: "evt-123" };
    },
    patchEvent: async (calendarId, eventId) => {
      calls.push({ kind: "patch", calendarId, eventId });
    },
    deleteEvent: async (calendarId, eventId) => {
      calls.push({ kind: "delete", calendarId, eventId });
    },
    listCalendars: async () => [{ id: "primary", summary: "Agenda" }],
  };
}

const START = new Date("2026-10-02T07:00:00.000Z");
const END = new Date("2026-10-02T08:00:00.000Z");

async function seedBooking(status = "confirmed") {
  const s = await import("@/db/schema");
  await db.insert(s.user).values({ id: "u1", name: "Camille", email: "camille@example.com" });
  await db.insert(s.office).values({ id: "o1", name: "Cabinet", slug: "cabinet", address: "1 rue des Tilleuls" });
  await db.insert(s.room).values({ id: "room-a", officeId: "o1", name: "Salle A", color: "#000" });
  await db.insert(s.practitioner).values({
    id: "p1",
    officeId: "o1",
    userId: "u1",
    displayName: "Camille",
    slug: "camille",
  });
  await seedSingleVariant(db, { id: "st1", practitionerId: "p1", name: "Séance 60min", durationMin: 60, bufferAfterMin: 0 });
  await db.insert(s.booking).values({
    id: "b1",
    officeId: "o1",
    practitionerId: "p1",
    roomId: "room-a",
    sessionTypeId: "st1",
    sessionNameSnapshot: "Séance 60min",
    durationMinSnapshot: 60,
    bufferAfterMinSnapshot: 0,
    startAt: START,
    endAt: END,
    patientFirstName: "Jean",
    patientLastName: "Dupont",
    patientEmail: "jean@example.com",
    patientPhone: "0600000000",
    notes: "Première visite",
    status,
    cancelToken: "ct",
    rescheduleToken: "rt",
  });
}

describe("buildGoogleEvent", () => {
  it("anonymise par défaut (aucune donnée patient)", () => {
    const event = buildGoogleEvent({
      booking: {
        id: "b1",
        sessionNameSnapshot: "Séance 60min",
        startAt: START,
        endAt: END,
        patientFirstName: "Jean",
        patientLastName: "Dupont",
        patientEmail: "jean@example.com",
        patientPhone: "0600000000",
        notes: "Première visite",
      },
      practitionerName: "Camille",
      officeName: "Cabinet",
      officeAddress: "1 rue des Tilleuls",
      timeZone: "Europe/Paris",
      roomName: "Salle A",
      showPatientName: false,
    });
    expect(event.summary).toBe("Réservé");
    expect(event.description).not.toContain("Jean");
    expect(event.description).not.toContain("jean@example.com");
    expect(event.description).not.toContain("0600000000");
    expect(event.description).toContain("Salle A");
    expect(event.start).toEqual({ dateTime: START.toISOString(), timeZone: "Europe/Paris" });
  });

  it("opt-in : nom + contacts + notes inclus", () => {
    const event = buildGoogleEvent({
      booking: {
        id: "b1",
        sessionNameSnapshot: "Séance 60min",
        startAt: START,
        endAt: END,
        patientFirstName: "Jean",
        patientLastName: "Dupont",
        patientEmail: "jean@example.com",
        patientPhone: "0600000000",
        notes: "Première visite",
      },
      practitionerName: "Camille",
      officeName: "Cabinet",
      officeAddress: null,
      timeZone: "Europe/Paris",
      roomName: null,
      showPatientName: true,
    });
    expect(event.summary).toContain("Jean Dupont");
    expect(event.description).toContain("jean@example.com");
    expect(event.description).toContain("Première visite");
  });
});

describe("syncBookingToGoogle", () => {
  beforeEach(async () => {
    db = createMemoryDb();
    setConnection(db);
    await seedBooking();
  });

  it("push désactivé → statut none, aucun appel Google", async () => {
    const client = fakeClient();
    await syncBookingToGoogle(testPorts({ googleCalendar: { forUser: async () => client } }), "b1");
    expect(client.calls).toEqual([]);
    const row = await bookingsDal.getBookingRowById("b1");
    expect(row?.googleSyncStatus).toBe("none");
  });

  it("push activé → insert + statut ok + eventId persisté", async () => {
    const s = await import("@/db/schema");
    await db.insert(s.practitionerGoogle).values({ practitionerId: "p1", syncEnabled: true });
    const client = fakeClient();
    await syncBookingToGoogle(testPorts({ googleCalendar: { forUser: async () => client } }), "b1");
    expect(client.calls).toEqual([{ kind: "insert", calendarId: "primary" }]);
    const row = await bookingsDal.getBookingRowById("b1");
    expect(row?.googleSyncStatus).toBe("ok");
    expect(row?.googleEventId).toBe("evt-123");
  });

  it("événement existant → patch (pas d'insert)", async () => {
    const s = await import("@/db/schema");
    await db.insert(s.practitionerGoogle).values({ practitionerId: "p1", syncEnabled: true });
    const { eq } = await import("drizzle-orm");
    await db
      .update(s.booking)
      .set({ googleEventId: "evt-old", googleSyncStatus: "pending" })
      .where(eq(s.booking.id, "b1"));
    const client = fakeClient();
    await syncBookingToGoogle(testPorts({ googleCalendar: { forUser: async () => client } }), "b1");
    expect(client.calls).toEqual([{ kind: "patch", calendarId: "primary", eventId: "evt-old" }]);
  });

  it("annulation → suppression de l'événement miroir", async () => {
    const s = await import("@/db/schema");
    await db.insert(s.practitionerGoogle).values({ practitionerId: "p1", syncEnabled: true });
    const { eq } = await import("drizzle-orm");
    await db
      .update(s.booking)
      .set({ status: "cancelled", googleEventId: "evt-old" })
      .where(eq(s.booking.id, "b1"));
    const client = fakeClient();
    await syncBookingToGoogle(testPorts({ googleCalendar: { forUser: async () => client } }), "b1");
    expect(client.calls).toEqual([{ kind: "delete", calendarId: "primary", eventId: "evt-old" }]);
    const row = await bookingsDal.getBookingRowById("b1");
    expect(row?.googleSyncStatus).toBe("ok");
    expect(row?.googleEventId).toBeNull();
  });

  it("échec Google → statut error, jamais d'exception", async () => {
    const s = await import("@/db/schema");
    await db.insert(s.practitionerGoogle).values({ practitionerId: "p1", syncEnabled: true });
    const client = fakeClient();
    client.insertEvent = async () => {
      throw new Error("quota dépassé");
    };
    await expect(
      syncBookingToGoogle(testPorts({ googleCalendar: { forUser: async () => client } }), "b1"),
    ).resolves.toBeUndefined();
    const row = await bookingsDal.getBookingRowById("b1");
    expect(row?.googleSyncStatus).toBe("error");
    expect(row?.googleSyncError).toContain("quota");
  });

  it("syncMany compte succès et échecs", async () => {
    const s = await import("@/db/schema");
    await db.insert(s.practitionerGoogle).values({ practitionerId: "p1", syncEnabled: true });
    const ports = testPorts({ googleCalendar: { forUser: async () => fakeClient() } });
    expect(await syncMany(ports, ["b1"])).toEqual({ ok: 1, failed: 0 });
    const offline = testPorts({ googleCalendar: { forUser: async () => null } });
    expect(await syncMany(offline, ["b1"])).toEqual({ ok: 0, failed: 1 });
  });

  it("lastSyncAt suit l'horloge injectée", async () => {
    const s = await import("@/db/schema");
    await db.insert(s.practitionerGoogle).values({ practitionerId: "p1", syncEnabled: true });
    const at = new Date("2026-09-01T10:00:00.000Z");
    const client = fakeClient();
    await syncBookingToGoogle(
      testPorts({ clock: fixedClock(at), googleCalendar: { forUser: async () => client } }),
      "b1",
    );
    const { getGooglePrefs } = await import("@/dal/practitioner-google");
    expect((await getGooglePrefs("p1"))?.lastSyncAt?.getTime()).toBe(at.getTime());
  });
});
