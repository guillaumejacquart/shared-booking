import { beforeEach, describe, expect, it } from "vitest";

import * as practitionerGoogleDal from "@/dal/practitioner-google";
import type { Db } from "@/dal/types";
import type { CalendarClient, GoogleCalendarEvent } from "@/lib/google-calendar";
import { fixedClock } from "@/lib/ports";
import { clearGoogleBusyCache, getGoogleBusy, type GoogleBusyInput } from "@/services/google-busy";
import { createMemoryDb } from "@/test/memory-db";
import { setConnection } from "@/dal/connection";
import { testPorts } from "@/test/ports";

/**
 * Inbound Google : gating par préférences, filtrage des événements,
 * cache mémoire et fail-open (aucune exception vers l'appelant).
 */

const NOW = new Date("2026-09-14T06:00:00Z");
const BUSY_START = new Date("2026-09-14T08:15:00Z");
const BUSY_END = new Date("2026-09-14T09:15:00Z");
const INPUT: GoogleBusyInput = {
  practitionerId: "p1",
  from: NOW,
  to: new Date("2026-09-15T06:00:00Z"),
  timezone: "Europe/Paris",
};

let db: Db;
let listCalls: string[];
let events: GoogleCalendarEvent[];
let failure: Error | null;

function fakeClient(): CalendarClient {
  return {
    insertEvent: async () => ({ id: "evt" }),
    patchEvent: async () => {},
    deleteEvent: async () => {},
    listCalendars: async () => [],
    listEvents: async (calendarId) => {
      listCalls.push(calendarId);
      if (failure) throw failure;
      return events;
    },
  };
}

function ports() {
  return testPorts({
    clock: fixedClock(NOW),
    googleCalendar: { forUser: async () => fakeClient() },
  });
}

beforeEach(async () => {
  clearGoogleBusyCache();
  listCalls = [];
  failure = null;
  events = [
    {
      startAt: BUSY_START,
      endAt: BUSY_END,
      allDay: false,
      transparent: false,
      isMirror: false,
    },
  ];
  db = createMemoryDb();
  setConnection(db);
  const s = await import("@/db/schema");
  await db.insert(s.user).values({ id: "u1", name: "Camille", email: "camille@example.com" });
  await db.insert(s.office).values({ id: "o1", name: "Cabinet", slug: "cabinet" });
  await db.insert(s.practitioner).values({
    id: "p1",
    officeId: "o1",
    userId: "u1",
    displayName: "Camille",
    slug: "camille",
  });
});

async function prefs(input: Record<string, unknown>) {
  await practitionerGoogleDal.saveGooglePrefs("p1", input);
}

describe("getGoogleBusy", () => {
  it("ne lit rien quand le blocage est désactivé", async () => {
    await prefs({ blockEnabled: false });
    expect(await getGoogleBusy(ports(), INPUT)).toEqual([]);
    expect(listCalls).toEqual([]);
  });

  it("ne lit rien sans préférences (jamais connecté)", async () => {
    expect(await getGoogleBusy(ports(), INPUT)).toEqual([]);
    expect(listCalls).toEqual([]);
  });

  it("ne lit rien sans client Google (compte non connecté)", async () => {
    await prefs({ blockEnabled: true });
    expect(await getGoogleBusy(testPorts(), INPUT)).toEqual([]);
  });

  it("retourne les occupations de l'agenda principal et met en cache", async () => {
    await prefs({ blockEnabled: true });
    const busy = await getGoogleBusy(ports(), INPUT);
    expect(busy.map((interval) => interval.start.toISOString())).toEqual([
      BUSY_START.toISOString(),
    ]);
    // Deuxième appel dans la fenêtre de cache : aucun nouvel appel Google.
    await getGoogleBusy(ports(), INPUT);
    expect(listCalls).toEqual(["primary"]);
    clearGoogleBusyCache();
    await getGoogleBusy(ports(), INPUT);
    expect(listCalls).toEqual(["primary", "primary"]);
  });

  it("lit chaque agenda coché et fusionne les occupations", async () => {
    await prefs({ blockEnabled: true, blockCalendarIds: ["work", "perso"] });
    await getGoogleBusy(ports(), INPUT);
    expect(listCalls.sort()).toEqual(["perso", "work"]);
  });

  it("ignore les journées entières sauf si l'option est active", async () => {
    events = [
      {
        startAt: new Date("2026-09-14T00:00:00Z"),
        endAt: new Date("2026-09-15T00:00:00Z"),
        allDay: true,
        transparent: false,
        isMirror: false,
      },
    ];
    await prefs({ blockEnabled: true });
    expect(await getGoogleBusy(ports(), INPUT)).toEqual([]);
    clearGoogleBusyCache();
    await prefs({ blockAllDay: true });
    expect(await getGoogleBusy(ports(), INPUT)).toHaveLength(1);
  });

  it("fail-open : une panne Google laisse les créneaux ouverts", async () => {
    await prefs({ blockEnabled: true });
    failure = new Error("google down");
    await expect(getGoogleBusy(ports(), INPUT)).resolves.toEqual([]);
  });
});
