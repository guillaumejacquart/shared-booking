import { describe, expect, it } from "vitest";

import {
  cancelBookingSchema,
  createBookingSchema,
  rescheduleBookingSchema,
  slotsQuerySchema,
  validateBookingSchema,
} from "./bookings";
import {
  createExceptionSchema,
  replaceAvailabilitySchema,
  saveSessionTypeSchema,
  updateOfficeSettingsSchema,
} from "./schedule";
import { acceptInviteSchema, createInviteSchema, createOfficeSchema } from "./team";

/**
 * Validation de forme (routes) : chaque schéma accepte le valide et rejette
 * l'invalide avec le champ fautif. Les services ne reçoivent que du validé
 * (voir leurs tests pour les règles métier).
 */
describe("bookings schemas", () => {
  it("createBooking exige consentement et email valide", () => {
    const base = {
      practitionerSlug: "alice",
      sessionTypeId: "st1",
      startAt: "2026-09-14T08:00:00.000Z",
      patientFirstName: "Jean",
      patientLastName: "Dupont",
      patientEmail: "jean@example.com",
      consent: true as const,
    };
    expect(createBookingSchema.parse(base)).toMatchObject({ consent: true });
    expect(() => createBookingSchema.parse({ ...base, consent: false })).toThrowError(
      /consentement/,
    );
    expect(() =>
      createBookingSchema.parse({ ...base, patientEmail: "pas-un-email" }),
    ).toThrowError(/patientEmail/);
  });

  it("slotsQuery borne l'horizon et exige une date calendaire", () => {
    expect(
      slotsQuerySchema.parse({ practitionerSlug: "a", sessionTypeId: "s", fromDate: "2026-09-14" }),
    ).toMatchObject({ days: 14 });
    expect(() =>
      slotsQuerySchema.parse({ practitionerSlug: "a", sessionTypeId: "s", fromDate: "2026-09-14", days: 99 }),
    ).toThrowError(/days/);
  });

  it("cancel/reschedule/validate exigent leurs champs", () => {
    expect(cancelBookingSchema.parse({ token: "t", by: "patient" })).toBeDefined();
    expect(() => cancelBookingSchema.parse({ token: "t", by: "x" })).toThrowError(/by/);
    expect(
      rescheduleBookingSchema.parse({ token: "t", newStartAt: "2026-09-14T08:00:00.000Z" }),
    ).toBeDefined();
    expect(validateBookingSchema.parse({ bookingId: "b", requesterUserId: "u", accept: true })).toBeDefined();
  });
});

describe("schedule schemas", () => {
  const req = { practitionerId: "p", officeId: "o", requesterUserId: "u", requesterIsOwner: false };

  it("replaceAvailability refuse les horaires mal formés", () => {
    const rule = { weekday: 1, startTime: "09:00", endTime: "12:00", roomId: "r" };
    expect(replaceAvailabilitySchema.parse({ ...req, rules: [rule] })).toBeDefined();
    expect(() =>
      replaceAvailabilitySchema.parse({
        ...req,
        rules: [{ ...rule, startTime: "9h" }],
      }),
    ).toThrowError(/startTime/);
  });

  it("saveSessionType refuse les durées absurdes et le payant sans prix", () => {
    const base = { ...req, name: "X", durationMin: 45, bufferAfterMin: 5 };
    expect(saveSessionTypeSchema.parse(base)).toBeDefined();
    expect(() => saveSessionTypeSchema.parse({ ...base, durationMin: 0 })).toThrowError(
      /durationMin/,
    );
    expect(() => saveSessionTypeSchema.parse({ ...base, bufferAfterMin: 999 })).toThrowError(
      /bufferAfterMin/,
    );
  });

  it("createException exige une date calendaire AAAA-MM-JJ", () => {
    const base = { ...req, date: "2026-12-25", kind: "off" as const, fullDay: true };
    expect(createExceptionSchema.parse(base)).toBeDefined();
    expect(() => createExceptionSchema.parse({ ...base, date: "25/12/2026" })).toThrowError(/date/);
    expect(() => createExceptionSchema.parse({ ...base, date: "2026-02-30" })).toThrowError(/date/);
  });

  it("updateOfficeSettings borne les réglages", () => {
    expect(
      updateOfficeSettingsSchema.safeParse({ officeId: "o", requesterUserId: "u", bookingLeadTimeMin: 60 }).success,
    ).toBe(true);
    const bad = updateOfficeSettingsSchema.safeParse({ officeId: "o", requesterUserId: "u", bookingLeadTimeMin: -5 });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0].path).toEqual(["bookingLeadTimeMin"]);
  });
});

describe("team schemas", () => {
  it("createInvite refuse un email invalide", () => {
    const base = {
      officeId: "o",
      email: "x@example.com",
      role: "practitioner" as const,
      requesterUserId: "u",
      origin: "http://localhost:3000",
    };
    expect(createInviteSchema.parse(base)).toBeDefined();
    expect(() => createInviteSchema.parse({ ...base, email: "pas-un-email" })).toThrowError(/email/);
  });

  it("createOffice refuse un slug invalide", () => {
    const base = { userId: "u", userName: "N", name: "Cab", slug: "cab" };
    expect(createOfficeSchema.parse(base)).toBeDefined();
    expect(() => createOfficeSchema.parse({ ...base, slug: "mauvais slug!" })).toThrowError(/slug/);
  });

  it("acceptInvite exige tous les champs", () => {
    expect(
      acceptInviteSchema.parse({ token: "t", userId: "u", userEmail: "a@b.co", userName: "N" }),
    ).toBeDefined();
  });
});
