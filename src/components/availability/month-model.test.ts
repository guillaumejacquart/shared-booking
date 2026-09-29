import { describe, expect, it } from "vitest";

import { dayState, openableOnly, selectionKeys, type MonthData } from "./month-model";

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

  it("selectionKeys : fin exclusive", () => {
    const keys = selectionKeys(new Date("2026-09-19T00:00:00+02:00"), new Date("2026-09-21T00:00:00+02:00"));
    expect(keys).toEqual(["2026-09-19", "2026-09-20"]);
  });

  it("openableOnly : week-end seul → ouverture, plage mixte → fermeture", () => {
    expect(openableOnly(data, ["2026-09-19", "2026-09-20"])).toEqual(["2026-09-19", "2026-09-20"]);
    expect(openableOnly(data, ["2026-09-13", "2026-09-14"])).toBeNull();
  });
});
