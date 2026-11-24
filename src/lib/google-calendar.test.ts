import { describe, expect, it } from "vitest";

import { toGoogleCalendarEvent, type RawGoogleEvent } from "./google-calendar";

/**
 * Normalisation `events.list` → occupation absolue (inbound).
 * Une journée entière est datée en heure murale du cabinet, `end.date`
 * étant exclusif côté Google.
 */

const TZ = "Europe/Paris";

function raw(overrides: Partial<RawGoogleEvent> = {}): RawGoogleEvent {
  return {
    status: "confirmed",
    start: { dateTime: "2026-09-14T10:00:00+02:00" },
    end: { dateTime: "2026-09-14T11:00:00+02:00" },
    ...overrides,
  };
}

describe("toGoogleCalendarEvent", () => {
  it("convertit un événement horaire en instants UTC", () => {
    const event = toGoogleCalendarEvent(raw(), TZ);
    expect(event?.startAt.toISOString()).toBe("2026-09-14T08:00:00.000Z");
    expect(event?.endAt.toISOString()).toBe("2026-09-14T09:00:00.000Z");
    expect(event?.allDay).toBe(false);
  });

  it("date une journée entière en fuseau cabinet (fin exclusive)", () => {
    const event = toGoogleCalendarEvent(
      raw({ start: { date: "2026-09-14" }, end: { date: "2026-09-15" } }),
      TZ,
    );
    expect(event?.allDay).toBe(true);
    expect(event?.startAt.toISOString()).toBe("2026-09-13T22:00:00.000Z");
    expect(event?.endAt.toISOString()).toBe("2026-09-14T22:00:00.000Z");
  });

  it("ignore les événements annulés ou sans bornes exploitables", () => {
    expect(toGoogleCalendarEvent(raw({ status: "cancelled" }), TZ)).toBeNull();
    expect(toGoogleCalendarEvent(raw({ end: {} }), TZ)).toBeNull();
  });

  it("repère les événements « disponible » et les miroirs de l'app", () => {
    expect(toGoogleCalendarEvent(raw({ transparency: "transparent" }), TZ)?.transparent).toBe(true);
    expect(
      toGoogleCalendarEvent(
        raw({ extendedProperties: { private: { source: "shared-booking", bookingId: "b1" } } }),
        TZ,
      )?.isMirror,
    ).toBe(true);
  });
});
