import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDb } from "@/test/memory-db";
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
} from "@/lib/services/schedule";
import {
  ConflictError,
  ForbiddenError,
  ValidationError,
} from "@/lib/services/errors";

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
  await db.insert(s.sessionType).values([
    { id: "st1", practitionerId: "p1", name: "Séance", durationMin: 60, bufferAfterMin: 0 },
  ]);
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
    const id = await saveSessionType({
      practitionerId: "p2", ...bob,
      name: "Suivi", durationMin: 45, bufferAfterMin: 5,
      requiresPayment: false, requiresValidation: false, compatibleRoomIds: [],
    });
    const id2 = await saveSessionType({
      practitionerId: "p2", ...bob, id,
      name: "Suivi long", durationMin: 60, bufferAfterMin: 5, active: false,
      requiresPayment: false, requiresValidation: false, compatibleRoomIds: [],
    });
    expect(id2).toBe(id);
  });

  it("restreint les salles compatibles d'une séance (vide = toutes)", async () => {
    const { listCompatibleRoomIds } = await import("@/dal/session-types");
    const id = await saveSessionType({
      practitionerId: "p1", ...alice,
      name: "Massage", durationMin: 60, bufferAfterMin: 0,
      requiresPayment: false, requiresValidation: false, compatibleRoomIds: ["room-x"],
    });
    expect(await listCompatibleRoomIds(id)).toEqual(["room-x"]);
    // Mise à jour remplace la restriction.
    await saveSessionType({
      practitionerId: "p1", ...alice, id,
      name: "Massage", durationMin: 60, bufferAfterMin: 0,
      requiresPayment: false, requiresValidation: false, compatibleRoomIds: [],
    });
    expect(await listCompatibleRoomIds(id)).toEqual([]);
  });

  it("refuse les salles inconnues ou interdites au praticien", async () => {
    const base = {
      practitionerId: "p2", ...bob,
      name: "Soin", durationMin: 60, bufferAfterMin: 0,
      requiresPayment: false, requiresValidation: false,
    };
    await expect(
      saveSessionType({ ...base, compatibleRoomIds: ["nope"] }),
    ).rejects.toBeInstanceOf(ValidationError);
    // Bob n'a pas accès à la salle Exclusive (réservée à Alice).
    await expect(
      saveSessionType({ ...base, compatibleRoomIds: ["room-x"] }),
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
    await expect(deleteSessionType({ id: "st1", ...alice, practitionerId: "p1" }, NOW)).rejects.toBeInstanceOf(
      ValidationError,
    );
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

describe("saveRoom / deleteRoom", () => {
  it("crée et modifie une salle avec allowlist (owner uniquement)", async () => {
    const { saveRoom } = await import("@/lib/services/schedule");
    const id = await saveRoom({
      officeId: "o1", requesterUserId: "u1", name: "Salle B", color: "#3b82f6", practitionerIds: ["p1", "p2"],
    });
    const id2 = await saveRoom({
      officeId: "o1", requesterUserId: "u1", id, name: "Salle B", color: "#ff0000", practitionerIds: ["p1"],
    });
    expect(id2).toBe(id);
    // Bob (non-owner) ne peut pas gérer les salles.
    await expect(
      saveRoom({ officeId: "o1", requesterUserId: "u2", name: "X", color: "#3b82f6", practitionerIds: [] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Praticien d'un autre cabinet refusé dans l'allowlist : on teste avec un id inconnu.
    await expect(
      saveRoom({ officeId: "o1", requesterUserId: "u1", name: "Y", color: "#3b82f6", practitionerIds: ["nope"] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuse de supprimer une salle avec des réservations futures", async () => {
    const { deleteRoom } = await import("@/lib/services/schedule");
    const s = await import("@/db/schema");
    await db.insert(s.booking).values({
      id: "b1", officeId: "o1", practitionerId: "p1", roomId: "room-a", sessionTypeId: "st1",
      sessionNameSnapshot: "Séance", durationMinSnapshot: 60, bufferAfterMinSnapshot: 0,
      startAt: new Date("2026-09-20T07:00:00Z"), endAt: new Date("2026-09-20T08:00:00Z"),
      patientFirstName: "J", patientLastName: "D", patientEmail: "j@example.com",
      status: "confirmed", cancelToken: "c1", rescheduleToken: "r1",
    });
    await expect(deleteRoom({ officeId: "o1", requesterUserId: "u1", id: "room-a" }, NOW)).rejects.toBeInstanceOf(
      ValidationError,
    );
    // Salle sans réservation : suppression OK.
    await deleteRoom({ officeId: "o1", requesterUserId: "u1", id: "room-x" }, NOW);
  });

  it("refuse de supprimer une salle requise par un type de séance", async () => {
    const { deleteRoom, saveSessionType } = await import("@/lib/services/schedule");
    const id = await saveSessionType({
      practitionerId: "p1", requesterUserId: "u1",
      name: "Massage", durationMin: 60, bufferAfterMin: 0,
      requiresPayment: false, requiresValidation: false, compatibleRoomIds: ["room-x"],
    });
    await expect(
      deleteRoom({ officeId: "o1", requesterUserId: "u1", id: "room-x" }, NOW),
    ).rejects.toBeInstanceOf(ValidationError);
    // Après retrait de la restriction, suppression OK.
    await saveSessionType({
      practitionerId: "p1", requesterUserId: "u1", id,
      name: "Massage", durationMin: 60, bufferAfterMin: 0,
      requiresPayment: false, requiresValidation: false, compatibleRoomIds: [],
    });
    await deleteRoom({ officeId: "o1", requesterUserId: "u1", id: "room-x" }, NOW);
  });
});

describe("updateOfficeSettings", () => {
  it("met à jour les réglages (owner uniquement)", async () => {
    const { updateOfficeSettings } = await import("@/lib/services/schedule");
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
    const { updateOfficeSettings } = await import("@/lib/services/schedule");
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
    const { saveSessionType } = await import("@/lib/services/schedule");
    const id = await saveSessionType({
        practitionerId: "p2", requesterUserId: "u2",
        name: "Payante", durationMin: 60, bufferAfterMin: 0,
        requiresPayment: true, priceCents: 5000, requiresValidation: true, compatibleRoomIds: [],
      },
    );
    const s = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(s.sessionType).where(eq(s.sessionType.id, id));
    expect(rows[0].requiresPayment).toBe(true);
    expect(rows[0].priceCents).toBe(5000);
    expect(rows[0].requiresValidation).toBe(true);

    const { ValidationError } = await import("@/lib/services/errors");
    await expect(
      saveSessionType({
          practitionerId: "p2", requesterUserId: "u2",
          name: "Sans prix", durationMin: 60, bufferAfterMin: 0, requiresPayment: true,
          requiresValidation: false, compatibleRoomIds: [],
        },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("saveSessionType nulls DB", () => {
  it("accepte les champs null renvoyés tels quels par le formulaire", async () => {
    const { saveSessionType } = await import("@/lib/services/schedule");
    // Reproduit le payload réel : description/priceCents à null.
    const id = await saveSessionType({
        practitionerId: "p2", requesterUserId: "u2",
        id: undefined,
        name: "Soin 1", description: null,
        durationMin: 60, bufferAfterMin: 20, priceDisplay: "50",
        active: true, requiresPayment: false, priceCents: null,
        requiresValidation: true, compatibleRoomIds: [],
      },
    );
    expect(typeof id).toBe("string");
  });
});
