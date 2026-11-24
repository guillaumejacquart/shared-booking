import { describe, expect, it } from "vitest";

import { busyIntervals, mergeIntervals } from "./google-busy";
import type { GoogleCalendarEvent } from "./google-calendar";

function event(overrides: Partial<GoogleCalendarEvent> = {}): GoogleCalendarEvent {
  return {
    startAt: new Date("2026-09-14T08:00:00Z"),
    endAt: new Date("2026-09-14T09:00:00Z"),
    allDay: false,
    transparent: false,
    isMirror: false,
    ...overrides,
  };
}

describe("busyIntervals", () => {
  it("garde les événements occupés", () => {
    expect(busyIntervals([event()], { includeAllDay: false })).toEqual([
      {
        start: new Date("2026-09-14T08:00:00Z"),
        end: new Date("2026-09-14T09:00:00Z"),
      },
    ]);
  });

  it("ignore les événements marqués « disponible » (transparent)", () => {
    expect(
      busyIntervals([event({ transparent: true })], { includeAllDay: true }),
    ).toEqual([]);
  });

  it("ignore les miroirs créés par l'app (réservation déjà connue)", () => {
    expect(
      busyIntervals([event({ isMirror: true })], { includeAllDay: true }),
    ).toEqual([]);
  });

  it("ignore les journées entières par défaut, les bloque sur demande", () => {
    const allDay = event({ allDay: true });
    expect(busyIntervals([allDay], { includeAllDay: false })).toEqual([]);
    expect(busyIntervals([allDay], { includeAllDay: true })).toHaveLength(1);
  });

  it("fusionne les chevauchements et les plages qui se touchent", () => {
    const merged = busyIntervals(
      [
        event({
          startAt: new Date("2026-09-14T08:00:00Z"),
          endAt: new Date("2026-09-14T09:00:00Z"),
        }),
        event({
          startAt: new Date("2026-09-14T09:00:00Z"),
          endAt: new Date("2026-09-14T10:00:00Z"),
        }),
        event({
          startAt: new Date("2026-09-14T08:30:00Z"),
          endAt: new Date("2026-09-14T08:45:00Z"),
        }),
        event({
          startAt: new Date("2026-09-14T11:00:00Z"),
          endAt: new Date("2026-09-14T12:00:00Z"),
        }),
      ],
      { includeAllDay: false },
    );
    expect(merged.map((busy) => [busy.start.toISOString(), busy.end.toISOString()])).toEqual([
      ["2026-09-14T08:00:00.000Z", "2026-09-14T10:00:00.000Z"],
      ["2026-09-14T11:00:00.000Z", "2026-09-14T12:00:00.000Z"],
    ]);
  });
});

describe("mergeIntervals", () => {
  it("ne modifie pas les entrées d'origine", () => {
    const first = { start: new Date("2026-09-14T08:00:00Z"), end: new Date("2026-09-14T09:00:00Z") };
    const second = { start: new Date("2026-09-14T08:30:00Z"), end: new Date("2026-09-14T10:00:00Z") };
    const merged = mergeIntervals([first, second]);
    expect(first.end.toISOString()).toBe("2026-09-14T09:00:00.000Z");
    expect(merged).toHaveLength(1);
  });
});
