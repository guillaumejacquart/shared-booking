import { describe, expect, it } from "vitest";

import { generateSlots, type SlotRequest } from "./slots";

const TZ = "Europe/Paris";
const ROOM_A = "room-a";
const ROOM_B = "room-b";

// Lundi 14 sept. 2026 08:00 UTC = 10:00 Paris (heure d'été, UTC+2).
const MON_10H = new Date("2026-09-14T08:00:00Z");

function base(overrides: Partial<SlotRequest> = {}): SlotRequest {
  return {
    timezone: TZ,
    windows: [],
    exceptions: [],
    practitionerBusy: [],
    roomBusy: {},
    sessionDurationMin: 60,
    bufferAfterMin: 0,
    leadTimeMin: 0,
    from: MON_10H,
    days: 1,
    ...overrides,
  };
}

function iso(slot: { start: Date; end: Date; roomId: string }) {
  return `${slot.start.toISOString()}→${slot.end.toISOString()}@${slot.roomId}`;
}

describe("generateSlots", () => {
  it("découpe une fenêtre en créneaux accolés", () => {
    const slots = generateSlots(
      base({
        windows: [{ weekday: 1, startTime: "09:00", endTime: "12:00", roomId: ROOM_A }],
      }),
    );
    // from = lundi 10h Paris : le créneau de 9h est passé, restent 10h et 11h.
    expect(slots.map(iso)).toEqual([
      "2026-09-14T08:00:00.000Z→2026-09-14T09:00:00.000Z@room-a",
      "2026-09-14T09:00:00.000Z→2026-09-14T10:00:00.000Z@room-a",
    ]);
  });

  it("applique durée + buffer différents (45min + 10min)", () => {
    const slots = generateSlots(
      base({
        from: new Date("2026-09-14T06:00:00Z"), // 8h Paris, avant l'ouverture
        windows: [{ weekday: 1, startTime: "09:00", endTime: "12:00", roomId: ROOM_A }],
        sessionDurationMin: 45,
        bufferAfterMin: 10,
      }),
    );
    expect(slots.map(iso)).toEqual([
      "2026-09-14T07:00:00.000Z→2026-09-14T07:45:00.000Z@room-a", // 09:00
      "2026-09-14T07:55:00.000Z→2026-09-14T08:40:00.000Z@room-a", // 09:55
      "2026-09-14T08:50:00.000Z→2026-09-14T09:35:00.000Z@room-a", // 10:50
      // 11:45 + 45min = 12:30 > 12:00 → exclu
    ]);
  });

  it("convertit correctement l'heure d'hiver (UTC+1)", () => {
    const slots = generateSlots(
      base({
        from: new Date("2026-01-11T07:00:00Z"), // dim. 8h Paris (hiver)
        days: 1,
        windows: [{ weekday: 0, startTime: "09:00", endTime: "10:00", roomId: ROOM_A }],
      }),
    );
    expect(slots.map(iso)).toEqual([
      "2026-01-11T08:00:00.000Z→2026-01-11T09:00:00.000Z@room-a", // 9h Paris = 8h UTC
    ]);
  });

  it("bloque les créneaux déjà pris par le praticien", () => {
    const slots = generateSlots(
      base({
        from: new Date("2026-09-14T06:00:00Z"),
        windows: [{ weekday: 1, startTime: "09:00", endTime: "12:00", roomId: ROOM_A }],
        practitionerBusy: [
          { start: new Date("2026-09-14T07:00:00Z"), end: new Date("2026-09-14T08:00:00Z") },
        ],
      }),
    );
    expect(slots.map((s) => s.start.toISOString())).toEqual([
      "2026-09-14T08:00:00.000Z",
      "2026-09-14T09:00:00.000Z",
    ]);
  });

  it("scénario pilote : P2 réserve 9h en salle A → P3 perd 9h mais garde 10h", () => {
    const req = base({
      from: new Date("2026-09-14T06:00:00Z"),
      windows: [{ weekday: 2, startTime: "09:00", endTime: "12:00", roomId: ROOM_A }],
      sessionDurationMin: 45,
      bufferAfterMin: 15, // occupation 09:00→10:00
      days: 2, // lun. + mar.
      roomBusy: {
        [ROOM_A]: [
          // Réservation de P2 : 9h00–9h45 + 15min de buffer = occupé jusqu'à 10h.
          { start: new Date("2026-09-15T07:00:00Z"), end: new Date("2026-09-15T08:00:00Z") },
        ],
      },
    });
    const slots = generateSlots(req);
    const tuesday = slots.filter((s) => s.start.toISOString().startsWith("2026-09-15"));
    expect(tuesday.map((s) => s.start.toISOString())).toEqual([
      "2026-09-15T08:00:00.000Z", // 10:00 Paris
      "2026-09-15T09:00:00.000Z", // 11:00 Paris
    ]);
  });

  it("respecte le délai minimum de réservation (lead time)", () => {
    const slots = generateSlots(
      base({
        windows: [{ weekday: 1, startTime: "09:00", endTime: "13:00", roomId: ROOM_A }],
        leadTimeMin: 120, // from = 10h → créneaux dès 12h
      }),
    );
    expect(slots.map((s) => s.start.toISOString())).toEqual([
      "2026-09-14T10:00:00.000Z", // 12h Paris ; 13h finirait à 14h > fin de fenêtre
    ]);
  });

  it("un jour off complet masque toute la journée", () => {
    const slots = generateSlots(
      base({
        from: new Date("2026-09-14T06:00:00Z"),
        windows: [{ weekday: 1, startTime: "09:00", endTime: "12:00", roomId: ROOM_A }],
        exceptions: [{ date: "2026-09-14", kind: "off", fullDay: true }],
      }),
    );
    expect(slots).toEqual([]);
  });

  it("un off partiel ne bloque que la plage concernée", () => {
    const slots = generateSlots(
      base({
        from: new Date("2026-09-14T06:00:00Z"),
        windows: [{ weekday: 1, startTime: "09:00", endTime: "12:00", roomId: ROOM_A }],
        exceptions: [
          { date: "2026-09-14", kind: "off", fullDay: false, startTime: "10:00", endTime: "11:00" },
        ],
      }),
    );
    expect(slots.map((s) => s.start.toISOString())).toEqual([
      "2026-09-14T07:00:00.000Z", // 9h
      "2026-09-14T09:00:00.000Z", // 11h
    ]);
  });

  it("une ouverture exceptionnelle ajoute des créneaux hors règles", () => {
    const slots = generateSlots(
      base({
        from: new Date("2026-09-18T06:00:00Z"), // vendredi
        days: 2, // ven. + sam.
        windows: [],
        exceptions: [
          { date: "2026-09-19", kind: "extra", fullDay: false, startTime: "09:00", endTime: "11:00", roomId: ROOM_B },
        ],
      }),
    );
    expect(slots.map(iso)).toEqual([
      "2026-09-19T07:00:00.000Z→2026-09-19T08:00:00.000Z@room-b",
      "2026-09-19T08:00:00.000Z→2026-09-19T09:00:00.000Z@room-b",
    ]);
  });

  it("deux occupations qui se touchent ne se bloquent pas", () => {
    const slots = generateSlots(
      base({
        from: new Date("2026-09-14T06:00:00Z"),
        windows: [{ weekday: 1, startTime: "09:00", endTime: "11:00", roomId: ROOM_A }],
        practitionerBusy: [
          { start: new Date("2026-09-14T06:00:00Z"), end: new Date("2026-09-14T07:00:00Z") },
        ],
      }),
    );
    expect(slots.map((s) => s.start.toISOString())).toEqual([
      "2026-09-14T07:00:00.000Z",
      "2026-09-14T08:00:00.000Z",
    ]);
  });
});
