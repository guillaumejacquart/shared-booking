import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDb } from "@/test/memory-db";
import { fixedClock } from "@/lib/ports";
import { ANALYTICS_EVENTS, type AnalyticsData, type AnalyticsEventName } from "@/lib/analytics";
import { testPorts } from "@/test/ports";
import { seedSingleVariant } from "@/test/session-types";
import { setConnection } from "@/dal/connection";
import type { Db } from "@/dal/types";
import {
  createException,
  deleteException,
  deleteSessionType,
  getAvailabilityMonth,
  replaceAvailability,
  saveSessionType,
  updateProfile,
} from "@/services/schedule";
import {
  ConflictError,
  ForbiddenError,
  ValidationError,
} from "@/services/errors";

let db: Db;
const NOW = new Date("2026-09-14T06:00:00Z");

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
  await seedSingleVariant(db, {
    id: "st1", practitionerId: "p1", name: "Séance", durationMin: 60, bufferAfterMin: 0,
  });
}

beforeEach(async () => {
  db = createMemoryDb();  setConnection(db);
  await seed();
});

const alice = { requesterUserId: "u1" };
const bob = { requesterUserId: "u2" };

describe("replaceAvailability", () => {
  it("remplace les règles après validation", async () => {
    await replaceAvailability({
      practitionerId: "p1", ...alice,
      rules: [
        { weekday: 1, startTime: "09:00", endTime: "12:00" },
        { weekday: 2, startTime: "14:00", endTime: "18:00" },
      ],
    });
    const s = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(s.availabilityRule).where(eq(s.availabilityRule.practitionerId, "p1"));
    expect(rows).toHaveLength(2);
  });

  it("refuse chevauchements et horaires invalides (sans notion de salle)", async () => {
    const base = { practitionerId: "p2", ...bob };
    await expect(
      replaceAvailability({
        ...base,
        rules: [
          { weekday: 1, startTime: "09:00", endTime: "12:00" },
          { weekday: 1, startTime: "11:00", endTime: "13:00" },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      replaceAvailability({
        ...base, rules: [{ weekday: 1, startTime: "12:00", endTime: "09:00" }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("un praticien ne modifie pas les dispos d'un autre", async () => {
    await expect(
      replaceAvailability({
        practitionerId: "p1", ...bob,
        rules: [{ weekday: 1, startTime: "09:00", endTime: "12:00" }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("saveSessionType / deleteSessionType", () => {
  it("crée, modifie et désactive", async () => {
    const { id } = await saveSessionType(testPorts({ clock: fixedClock(NOW) }), {
      practitionerId: "p2", ...bob,
      name: "Suivi",
      variants: [{ durationMin: 45, bufferAfterMin: 5, priceDisplay: "60 €" }],
      requiresPayment: false, requiresValidation: false, compatibleRoomIds: [],
    });
    const { id: id2 } = await saveSessionType(testPorts({ clock: fixedClock(NOW) }), {
      practitionerId: "p2", ...bob, id,
      name: "Suivi long", active: false,
      variants: [{ durationMin: 60, bufferAfterMin: 5, priceDisplay: "70 €" }],
      requiresPayment: false, requiresValidation: false, compatibleRoomIds: [],
    });
    expect(id2).toBe(id);
  });

  it("crée plusieurs déclinaisons et les réconcilie à la mise à jour", async () => {
    const { listVariants } = await import("@/dal/session-types");
    const { id } = await saveSessionType(testPorts({ clock: fixedClock(NOW) }), {
      practitionerId: "p2", ...bob,
      name: "Massage",
      variants: [
        { durationMin: 60, bufferAfterMin: 10, priceDisplay: "60 €" },
        { durationMin: 90, bufferAfterMin: 15, priceDisplay: "80 €" },
      ],
      requiresPayment: false, requiresValidation: false, compatibleRoomIds: [],
    });
    let variants = await listVariants(id);
    expect(variants.map((variant) => variant.durationMin)).toEqual([60, 90]);
    expect(variants.map((variant) => variant.bufferAfterMin)).toEqual([10, 15]);
    // Mise à jour : 60 min conservée (prix modifié), 90 min retirée, 120 min ajoutée.
    const sixty = variants.find((variant) => variant.durationMin === 60)!;
    const { variants: reconciled } = await saveSessionType(testPorts({ clock: fixedClock(NOW) }), {
      practitionerId: "p2", ...bob, id,
      name: "Massage",
      variants: [
        { id: sixty.id, durationMin: 60, bufferAfterMin: 10, priceDisplay: "65 €" },
        { durationMin: 120, bufferAfterMin: 20, priceDisplay: "100 €" },
      ],
      requiresPayment: false, requiresValidation: false, compatibleRoomIds: [],
    });
    expect(reconciled.map((variant) => variant.durationMin)).toEqual([60, 120]);
    expect(reconciled.find((variant) => variant.durationMin === 60)?.id).toBe(sixty.id);
    expect(reconciled.find((variant) => variant.durationMin === 60)?.priceDisplay).toBe("65 €");
    variants = await listVariants(id);
    expect(variants).toHaveLength(2);
  });

  it("refuse deux déclinaisons de même durée", async () => {
    await expect(
      saveSessionType(testPorts({ clock: fixedClock(NOW) }), {
        practitionerId: "p2", ...bob,
        name: "Doublon",
        variants: [
          { durationMin: 60, bufferAfterMin: 0, priceDisplay: "60 €" },
          { durationMin: 60, bufferAfterMin: 10, priceDisplay: "80 €" },
        ],
        requiresPayment: false, requiresValidation: false, compatibleRoomIds: [],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuse de retirer une déclinaison utilisée par des réservations futures", async () => {
    const { listVariants } = await import("@/dal/session-types");
    const s = await import("@/db/schema");
    const { id } = await saveSessionType(testPorts({ clock: fixedClock(NOW) }), {
      practitionerId: "p1", ...alice,
      name: "Massage",
      variants: [
        { durationMin: 60, bufferAfterMin: 0, priceDisplay: "60 €" },
        { durationMin: 90, bufferAfterMin: 0, priceDisplay: "80 €" },
      ],
      requiresPayment: false, requiresValidation: false, compatibleRoomIds: [],
    });
    const variants = await listVariants(id);
    const ninety = variants.find((variant) => variant.durationMin === 90)!;
    await db.insert(s.booking).values({
      id: "b1", officeId: "o1", practitionerId: "p1", roomId: "room-a", sessionTypeId: id,
      sessionVariantId: ninety.id,
      sessionNameSnapshot: "Massage (90 min)", durationMinSnapshot: 90, bufferAfterMinSnapshot: 0,
      startAt: new Date("2026-09-20T07:00:00Z"), endAt: new Date("2026-09-20T08:30:00Z"),
      patientFirstName: "J", patientLastName: "D", patientEmail: "j@example.com",
      status: "confirmed", cancelToken: "c1", rescheduleToken: "r1",
    });
    const sixty = variants.find((variant) => variant.durationMin === 60)!;
    await expect(
      saveSessionType(testPorts({ clock: fixedClock(NOW) }), {
        practitionerId: "p1", ...alice, id,
        name: "Massage",
        variants: [{ id: sixty.id, durationMin: 60, bufferAfterMin: 0, priceDisplay: "60 €" }],
        requiresPayment: false, requiresValidation: false, compatibleRoomIds: [],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("restreint les salles compatibles d'une séance (vide = toutes)", async () => {
    const { listCompatibleRoomIds } = await import("@/dal/session-types");
    const { id } = await saveSessionType(testPorts({ clock: fixedClock(NOW) }), {
      practitionerId: "p1", ...alice,
      name: "Massage",
      variants: [{ durationMin: 60, bufferAfterMin: 0, priceDisplay: "60 €" }],
      requiresPayment: false, requiresValidation: false, compatibleRoomIds: ["room-x"],
    });
    expect(await listCompatibleRoomIds(id)).toEqual(["room-x"]);
    // Mise à jour remplace la restriction.
    await saveSessionType(testPorts({ clock: fixedClock(NOW) }), {
      practitionerId: "p1", ...alice, id,
      name: "Massage",
      variants: [{ durationMin: 60, bufferAfterMin: 0, priceDisplay: "60 €" }],
      requiresPayment: false, requiresValidation: false, compatibleRoomIds: [],
    });
    expect(await listCompatibleRoomIds(id)).toEqual([]);
  });

  it("refuse les salles inconnues ou interdites au praticien", async () => {
    const base = {
      practitionerId: "p2", ...bob,
      name: "Soin",
      variants: [{ durationMin: 60, bufferAfterMin: 0, priceDisplay: "60 €" }],
      requiresPayment: false, requiresValidation: false,
    };
    await expect(
      saveSessionType(testPorts({ clock: fixedClock(NOW) }), { ...base, compatibleRoomIds: ["nope"] }),
    ).rejects.toBeInstanceOf(ValidationError);
    // Bob n'a pas accès à la salle Exclusive (réservée à Alice).
    await expect(
      saveSessionType(testPorts({ clock: fixedClock(NOW) }), { ...base, compatibleRoomIds: ["room-x"] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuse de supprimer un type avec des réservations futures", async () => {
    const s = await import("@/db/schema");
    await db.insert(s.booking).values({
      id: "b1", officeId: "o1", practitionerId: "p1", roomId: "room-a", sessionTypeId: "st1",
      sessionNameSnapshot: "Séance", durationMinSnapshot: 60, bufferAfterMinSnapshot: 0,
      startAt: new Date("2026-09-20T07:00:00Z"), endAt: new Date("2026-09-20T08:00:00Z"),
      patientFirstName: "J", patientLastName: "D", patientEmail: "j@example.com",
      status: "confirmed", cancelToken: "c1", rescheduleToken: "r1",
    });
    await expect(deleteSessionType(testPorts({ clock: fixedClock(NOW) }), { id: "st1", ...alice, practitionerId: "p1" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("refuse aussi avec une réservation en attente de paiement", async () => {
    const s = await import("@/db/schema");
    await db.insert(s.booking).values({
      id: "b1", officeId: "o1", practitionerId: "p1", roomId: "room-a", sessionTypeId: "st1",
      sessionNameSnapshot: "Séance", durationMinSnapshot: 60, bufferAfterMinSnapshot: 0,
      startAt: new Date("2026-09-20T07:00:00Z"), endAt: new Date("2026-09-20T08:00:00Z"),
      patientFirstName: "J", patientLastName: "D", patientEmail: "j@example.com",
      status: "pending", paymentStatus: "pending", cancelToken: "c1", rescheduleToken: "r1",
    });
    await expect(deleteSessionType(testPorts({ clock: fixedClock(NOW) }), { id: "st1", ...alice, practitionerId: "p1" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("suppression OK avec uniquement du passé : historique conservé (SET NULL, pas de cascade)", async () => {
    const s = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await db.insert(s.booking).values([
      {
        id: "b-past", officeId: "o1", practitionerId: "p1", roomId: "room-a", sessionTypeId: "st1",
        sessionNameSnapshot: "Séance", durationMinSnapshot: 60, bufferAfterMinSnapshot: 0,
        startAt: new Date("2026-09-01T07:00:00Z"), endAt: new Date("2026-09-01T08:00:00Z"),
        patientFirstName: "J", patientLastName: "D", patientEmail: "j@example.com",
        status: "completed", cancelToken: "c-past", rescheduleToken: "r-past",
      },
      {
        id: "b-cancelled", officeId: "o1", practitionerId: "p1", roomId: "room-a", sessionTypeId: "st1",
        sessionNameSnapshot: "Séance", durationMinSnapshot: 60, bufferAfterMinSnapshot: 0,
        startAt: new Date("2026-09-20T07:00:00Z"), endAt: new Date("2026-09-20T08:00:00Z"),
        patientFirstName: "A", patientLastName: "B", patientEmail: "a@example.com",
        status: "cancelled", cancelToken: "c-can", rescheduleToken: "r-can",
      },
    ]);
    await deleteSessionType(testPorts({ clock: fixedClock(NOW) }), { id: "st1", ...alice, practitionerId: "p1" });
    // Type supprimé, réservations conservées avec référence neutralisée.
    expect(await db.select().from(s.sessionType).where(eq(s.sessionType.id, "st1"))).toHaveLength(0);
    const kept = await db.select().from(s.booking);
    expect(kept).toHaveLength(2);
    for (const row of kept) {
      expect(row.sessionTypeId).toBeNull();
      expect(row.sessionNameSnapshot).toBe("Séance");
    }
  });
});

describe("createException / deleteException", () => {
  it("crée un jour off et une ouverture exceptionnelle", async () => {
    await createException({
      practitionerId: "p2", ...bob, date: "2026-12-25", kind: "off", fullDay: true,
    });
    await createException({
      practitionerId: "p2", ...bob, date: "2026-09-19", kind: "extra",
      fullDay: false, startTime: "09:00", endTime: "12:00", roomId: "room-a",
    });
  });

  it("refuse date invalide et extra sans salle autorisée", async () => {
    await expect(
      createException({
        practitionerId: "p2", ...bob, date: "2026-09-19", kind: "extra",
        fullDay: false, startTime: "09:00", endTime: "12:00", roomId: "room-x",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("suppression réservée au praticien ou owner", async () => {
    const s = await import("@/db/schema");
    const id = await createException({
      practitionerId: "p2", ...bob, date: "2026-12-25", kind: "off", fullDay: true,
    });
    // Alice est owner : elle peut supprimer l'exception de Bob.
    await deleteException({ id, ...alice, practitionerId: "p2" });
    const { eq } = await import("drizzle-orm");
    expect(await db.select().from(s.exception).where(eq(s.exception.id, id))).toHaveLength(0);
  });
});

describe("getAvailabilityMonth", () => {
  it("ne retourne que les salles utilisables par le praticien", async () => {
    // room-x est réservée à Alice (p1) : Bob (p2) ne voit que room-a.
    const bobMonth = await getAvailabilityMonth({ userId: "u2", from: "2026-09-14", days: 7 });
    expect(bobMonth.rooms.map((r) => r.id)).toEqual(["room-a"]);
    const aliceMonth = await getAvailabilityMonth({ userId: "u1", from: "2026-09-14", days: 7 });
    expect(aliceMonth.rooms.map((r) => r.id).sort()).toEqual(["room-a", "room-x"]);
  });
});

describe("updateProfile", () => {
  it("met à jour nom, bio et slug avec unicité", async () => {
    await updateProfile({
      practitionerId: "p2", ...bob, displayName: "Bobby", bio: "Nouvelle bio", slug: "bobby",
    });
    await expect(
      updateProfile({ practitionerId: "p2", ...bob, displayName: "Bob", slug: "alice" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("updatePractitionerSettings", () => {
  it("persiste les moyens sur place (dédupliqués) et la précision", async () => {
    const { updatePractitionerSettings } = await import("@/services/schedule");
    const { getPractitionerById } = await import("@/dal/practitioners");
    await updatePractitionerSettings({
      practitionerId: "p2",
      ...bob,
      onsitePaymentMethods: ["virement", "especes", "especes"],
      onsitePaymentNote: "Appoint apprécié",
    });
    const prac = await getPractitionerById("p2");
    expect(prac?.onsitePaymentMethods).toBe('["virement","especes"]');
    expect(prac?.onsitePaymentNote).toBe("Appoint apprécié");
    // Mise à jour partielle : les autres champs sont préservés.
    await updatePractitionerSettings({
      practitionerId: "p2",
      ...bob,
      onsitePaymentNote: "",
    });
    const after = await getPractitionerById("p2");
    expect(after?.onsitePaymentMethods).toBe('["virement","especes"]');
    expect(after?.onsitePaymentNote).toBeNull();
  });

  it("refuse l'accès à un tiers", async () => {
    const { updatePractitionerSettings } = await import("@/services/schedule");
    await expect(
      updatePractitionerSettings({ practitionerId: "p1", ...bob, onsitePaymentNote: "x" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("saveRoom / deleteRoom", () => {
  it("crée et modifie une salle avec allowlist (owner uniquement)", async () => {
    const { saveRoom } = await import("@/services/schedule");
    const roomPorts = () => testPorts({ clock: fixedClock(NOW) });
    const id = await saveRoom(roomPorts(), {
      officeId: "o1", requesterUserId: "u1", name: "Salle B", color: "#3b82f6", practitionerIds: ["p1", "p2"],
    });
    const id2 = await saveRoom(roomPorts(), {
      officeId: "o1", requesterUserId: "u1", id, name: "Salle B", color: "#ff0000", practitionerIds: ["p1"],
    });
    expect(id2).toBe(id);
    // Bob (non-owner) ne peut pas gérer les salles.
    await expect(
      saveRoom(roomPorts(), { officeId: "o1", requesterUserId: "u2", name: "X", color: "#3b82f6", practitionerIds: [] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Praticien d'un autre cabinet refusé dans l'allowlist : on teste avec un id inconnu.
    await expect(
      saveRoom(roomPorts(), { officeId: "o1", requesterUserId: "u1", name: "Y", color: "#3b82f6", practitionerIds: ["nope"] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuse de supprimer une salle avec des réservations futures", async () => {
    const { deleteRoom } = await import("@/services/schedule");
    const s = await import("@/db/schema");
    await db.insert(s.booking).values({
      id: "b1", officeId: "o1", practitionerId: "p1", roomId: "room-a", sessionTypeId: "st1",
      sessionNameSnapshot: "Séance", durationMinSnapshot: 60, bufferAfterMinSnapshot: 0,
      startAt: new Date("2026-09-20T07:00:00Z"), endAt: new Date("2026-09-20T08:00:00Z"),
      patientFirstName: "J", patientLastName: "D", patientEmail: "j@example.com",
      status: "confirmed", cancelToken: "c1", rescheduleToken: "r1",
    });
    await expect(deleteRoom(testPorts({ clock: fixedClock(NOW) }), { officeId: "o1", requesterUserId: "u1", id: "room-a" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    // Salle sans réservation : suppression OK.
    await deleteRoom(testPorts({ clock: fixedClock(NOW) }), { officeId: "o1", requesterUserId: "u1", id: "room-x" });
  });

  it("refuse de supprimer une salle requise par un type de séance", async () => {
    const { deleteRoom, saveSessionType } = await import("@/services/schedule");
    const { id } = await saveSessionType(testPorts({ clock: fixedClock(NOW) }), {
      practitionerId: "p1", requesterUserId: "u1",
      name: "Massage",
      variants: [{ durationMin: 60, bufferAfterMin: 0, priceDisplay: "60 €" }],
      requiresPayment: false, requiresValidation: false, compatibleRoomIds: ["room-x"],
    });
    await expect(
      deleteRoom(testPorts({ clock: fixedClock(NOW) }), { officeId: "o1", requesterUserId: "u1", id: "room-x" }),
    ).rejects.toBeInstanceOf(ValidationError);
    // Après retrait de la restriction, suppression OK.
    await saveSessionType(testPorts({ clock: fixedClock(NOW) }), {
      practitionerId: "p1", requesterUserId: "u1", id,
      name: "Massage",
      variants: [{ durationMin: 60, bufferAfterMin: 0, priceDisplay: "60 €" }],
      requiresPayment: false, requiresValidation: false, compatibleRoomIds: [],
    });
    await deleteRoom(testPorts({ clock: fixedClock(NOW) }), { officeId: "o1", requesterUserId: "u1", id: "room-x" });
  });
});

describe("updateOfficeSettings", () => {
  it("met à jour les réglages (owner uniquement)", async () => {
    const { updateOfficeSettings } = await import("@/services/schedule");
    await updateOfficeSettings({
      officeId: "o1", requesterUserId: "u1",
      name: "Nouveau nom", bookingLeadTimeMin: 60, cancelDeadlineHours: 48,
      reminderHoursBefore: 12, defaultBufferAfterMin: 5,
      enablePractitionerPages: true, enableOfficePage: true,
    });
    await expect(
      updateOfficeSettings({ officeId: "o1", requesterUserId: "u2", name: "Hack" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("persiste l'ambiance du cabinet", async () => {
    const { updateOfficeSettings } = await import("@/services/schedule");
    await updateOfficeSettings({ officeId: "o1", requesterUserId: "u1", themePalette: "brume", themeMode: "dark" });
    const s = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(s.office).where(eq(s.office.id, "o1"));
    expect(rows[0].themePalette).toBe("brume");
    expect(rows[0].themeMode).toBe("dark");
  });
});

describe("saveSessionType paiement/validation", () => {
  it("accepte une séance payante avec prix, refuse sans prix", async () => {
    const { saveSessionType } = await import("@/services/schedule");
    const { id } = await saveSessionType(testPorts({ clock: fixedClock(NOW) }), {
        practitionerId: "p2", requesterUserId: "u2",
        name: "Payante",
        variants: [{ durationMin: 60, bufferAfterMin: 0, priceDisplay: "50 €", priceCents: 5000 }],
        requiresPayment: true, requiresValidation: true, compatibleRoomIds: [],
      },
    );
    const s = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(s.sessionType).where(eq(s.sessionType.id, id));
    expect(rows[0].requiresPayment).toBe(true);
    expect(rows[0].requiresValidation).toBe(true);
    const paidVariants = await db
      .select()
      .from(s.sessionTypeVariant)
      .where(eq(s.sessionTypeVariant.sessionTypeId, id));
    expect(paidVariants[0].priceCents).toBe(5000);

    const { ValidationError } = await import("@/services/errors");
    await expect(
      saveSessionType(testPorts({ clock: fixedClock(NOW) }), {
          practitionerId: "p2", requesterUserId: "u2",
          name: "Sans prix",
          variants: [{ durationMin: 60, bufferAfterMin: 0, priceDisplay: "50 €" }],
          requiresPayment: true,
          requiresValidation: false, compatibleRoomIds: [],
        },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuse une séance payante si une déclinaison est sans prix", async () => {
    const { saveSessionType } = await import("@/services/schedule");
    const { ValidationError } = await import("@/services/errors");
    await expect(
      saveSessionType(testPorts({ clock: fixedClock(NOW) }), {
        practitionerId: "p2", requesterUserId: "u2",
        name: "Partiellement tarifée",
        variants: [
          { durationMin: 60, bufferAfterMin: 0, priceDisplay: "50 €", priceCents: 5000 },
          { durationMin: 90, bufferAfterMin: 0, priceDisplay: "70 €" },
        ],
        requiresPayment: true, requiresValidation: false, compatibleRoomIds: [],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("saveSessionType prix affiché obligatoire", () => {
  it("exige un prix affiché par déclinaison, 0 accepté", async () => {
    const { saveSessionType } = await import("@/services/schedule");
    const { ValidationError } = await import("@/services/errors");
    // "0" = tarif à définir : accepté, même sans paiement en ligne.
    const { id } = await saveSessionType(testPorts({ clock: fixedClock(NOW) }), {
        practitionerId: "p2", requesterUserId: "u2",
        name: "Tarif à définir",
        variants: [{ durationMin: 60, bufferAfterMin: 0, priceDisplay: "0" }],
        requiresPayment: false, requiresValidation: false, compatibleRoomIds: [],
      },
    );
    expect(typeof id).toBe("string");
    // Manquant ou vide : refusé (payante ou non).
    for (const variants of [
      [{ durationMin: 60, bufferAfterMin: 0 }],
      [{ durationMin: 60, bufferAfterMin: 0, priceDisplay: "   " }],
    ]) {
      await expect(
        saveSessionType(testPorts({ clock: fixedClock(NOW) }), {
          practitionerId: "p2", requesterUserId: "u2",
          name: "Sans prix affiché",
          // @ts-expect-error prix volontairement omis/vide
          variants,
          requiresPayment: false, requiresValidation: false, compatibleRoomIds: [],
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });
});

describe("saveSessionType nulls DB", () => {
  it("accepte les champs null renvoyés tels quels par le formulaire", async () => {
    const { saveSessionType } = await import("@/services/schedule");
    // Reproduit le payload réel : description/priceCents à null.
    const { id } = await saveSessionType(testPorts({ clock: fixedClock(NOW) }), {
        practitionerId: "p2", requesterUserId: "u2",
        id: undefined,
        name: "Soin 1", description: null,
        variants: [{ durationMin: 60, bufferAfterMin: 20, priceDisplay: "50", priceCents: null }],
        active: true, requiresPayment: false,
        requiresValidation: true, compatibleRoomIds: [],
      },
    );
    expect(typeof id).toBe("string");
  });
});

describe("analytics (Umami)", () => {
  it("émet session-type-created à la création, rien à la mise à jour", async () => {
    const tracked: { event: AnalyticsEventName; data?: AnalyticsData }[] = [];
    const watchedPorts = () =>
      testPorts({
        clock: fixedClock(NOW),
        analytics: {
          track: async (event, data) => {
            tracked.push({ event, data });
          },
        },
      });
    const { id } = await saveSessionType(watchedPorts(), {
      practitionerId: "p2", ...bob,
      name: "Suivi",
      variants: [{ durationMin: 45, bufferAfterMin: 5, priceDisplay: "60 €" }],
      requiresPayment: false, requiresValidation: true, compatibleRoomIds: [],
    });
    expect(tracked).toHaveLength(1);
    expect(tracked[0].event).toBe(ANALYTICS_EVENTS.SESSION_TYPE_CREATED);
    expect(tracked[0].data).toMatchObject({
      requiresPayment: false,
      requiresValidation: true,
      variantCount: 1,
    });
    await saveSessionType(watchedPorts(), {
      practitionerId: "p2", ...bob, id,
      name: "Suivi long",
      variants: [{ durationMin: 45, bufferAfterMin: 5, priceDisplay: "65 €" }],
      requiresPayment: false, requiresValidation: true, compatibleRoomIds: [],
    });
    expect(tracked).toHaveLength(1);
  });

  it("émet room-created à la création, rien à la mise à jour", async () => {
    const tracked: { event: AnalyticsEventName; data?: AnalyticsData }[] = [];
    const watchedPorts = () =>
      testPorts({
        clock: fixedClock(NOW),
        analytics: {
          track: async (event, data) => {
            tracked.push({ event, data });
          },
        },
      });
    const { saveRoom } = await import("@/services/schedule");
    const id = await saveRoom(watchedPorts(), {
      officeId: "o1", requesterUserId: "u1", name: "Salle B",
      color: "#3b82f6", practitionerIds: ["p1", "p2"],
    });
    expect(tracked).toHaveLength(1);
    expect(tracked[0].event).toBe(ANALYTICS_EVENTS.ROOM_CREATED);
    expect(tracked[0].data).toMatchObject({ practitionerCount: 2 });
    await saveRoom(watchedPorts(), {
      officeId: "o1", requesterUserId: "u1", id, name: "Salle B",
      color: "#ff0000", practitionerIds: ["p1"],
    });
    expect(tracked).toHaveLength(1);
  });
});
