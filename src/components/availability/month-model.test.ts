import { describe, expect, it } from "vitest";

import { dayAction, dayCoverage, dayRules, dayState, openableOnly, selectionKeys, trimOffs, type MonthData } from "./month-model";

// 2026-09-14 = lundi, 2026-09-19 = samedi.
const data: MonthData = {
  rules: [{ weekday: 1, startTime: "09:00", endTime: "18:00" }],
  exceptions: [
    { id: "off1", date: "2026-09-21", kind: "off", startTime: null, endTime: null, fullDay: true, roomId: null },
  ],
  bookings: [{ id: "b1", startAt: "2026-09-28T08:00:00.000Z", endAt: "2026-09-28T09:00:00.000Z", status: "confirmed" }],
  rooms: [{ id: "room-a", name: "Salle A" }],
};

describe("month-model", () => {
  it("dayState : ouverture habituelle, fermeture et RDV", () => {
    expect(dayState(data, "2026-09-14").regularOpen).toBe(true);
    expect(dayState(data, "2026-09-19").regularOpen).toBe(false);
    expect(dayState(data, "2026-09-21").fullOff?.id).toBe("off1");
    expect(dayState(data, "2026-09-28").bookings).toHaveLength(1);
  });

  it("dayAction : matrice des actions explicites", () => {
    expect(dayAction(data, "2026-09-14")).toEqual({ kind: "close" });
    expect(dayAction(data, "2026-09-19")).toEqual({ kind: "openExtra" });
    expect(dayAction(data, "2026-09-21")).toEqual({ kind: "reopen" });
    expect(dayAction(data, "2026-09-28")).toEqual({ kind: "blocked", count: 1 });
  });

  it("dayAction : extras, partielles et priorité fermeture", () => {
    const extended: MonthData = {
      ...data,
      exceptions: [
        ...data.exceptions,
        { id: "extra1", date: "2026-09-19", kind: "extra", startTime: "09:00", endTime: "12:00", fullDay: false, roomId: "room-a" },
        { id: "part1", date: "2026-09-14", kind: "off", startTime: "09:00", endTime: "12:00", fullDay: false, roomId: null },
      ],
      bookings: [
        ...data.bookings,
        { id: "b2", startAt: "2026-09-21T08:00:00.000Z", endAt: "2026-09-21T09:00:00.000Z", status: "confirmed" },
      ],
    };
    expect(dayState(extended, "2026-09-14").partialOffs.map((exception) => exception.id)).toEqual(["part1"]);
    expect(dayAction(extended, "2026-09-19")).toEqual({ kind: "cancelExtra" });
    expect(dayAction(extended, "2026-09-14")).toEqual({ kind: "cancelPartial", ranges: "09:00→12:00" });
    // La fermeture totale reste rouvrable même avec des RDV.
    expect(dayAction(extended, "2026-09-21")).toEqual({ kind: "reopen" });
  });

  it("dayCoverage + trimOffs : changement d'horaires du jour", () => {
    const rules = dayRules(data, "2026-09-14");
    expect(rules).toHaveLength(1);
    expect(dayCoverage(data, "2026-09-14")).toEqual({ startTime: "09:00", endTime: "18:00" });
    expect(dayCoverage(data, "2026-09-19")).toBeNull();
    // Rognage des deux côtés.
    expect(trimOffs(rules, "10:00", "16:00")).toEqual([
      { startTime: "09:00", endTime: "10:00" },
      { startTime: "16:00", endTime: "18:00" },
    ]);
    // Un seul côté + horaires identiques (aucune découpe).
    expect(trimOffs(rules, "09:00", "12:00")).toEqual([{ startTime: "12:00", endTime: "18:00" }]);
    expect(trimOffs(rules, "09:00", "18:00")).toEqual([]);
    // Hors couverture : rien à rogner (l'appelant rejette avant).
    expect(trimOffs(rules, "08:00", "19:00")).toEqual([]);
  });

  it("trimOffs : respecte les trous entre deux plages", () => {
    const split = [
      { weekday: 1, startTime: "09:00", endTime: "12:00" },
      { weekday: 1, startTime: "14:00", endTime: "18:00" },
    ];
    expect(trimOffs(split, "10:00", "17:00")).toEqual([
      { startTime: "09:00", endTime: "10:00" },
      { startTime: "17:00", endTime: "18:00" },
    ]);
  });

  it("selectionKeys : fin exclusive", () => {
    const keys = selectionKeys(new Date("2026-09-19T00:00:00+02:00"), new Date("2026-09-21T00:00:00+02:00"));
    expect(keys).toEqual(["2026-09-19", "2026-09-20"]);
  });

  it("openableOnly : week-end seul → ouverture, plage mixte → fermeture", () => {
    expect(openableOnly(data, ["2026-09-19", "2026-09-20"])).toEqual(["2026-09-19", "2026-09-20"]);
    expect(openableOnly(data, ["2026-09-13", "2026-09-14"])).toBeNull();
  });
});
