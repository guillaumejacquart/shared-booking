import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDb } from "@/test/memory-db";
import type { Db } from "@/dal/types";
import {
  createException,
  deleteException,
  deleteSessionType,
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
  db = createMemoryDb();
  await seed();
});

function deps() {
  return { db, now: NOW };
}

const alice = { requesterUserId: "u1", requesterIsOwner: true };
const bob = { requesterUserId: "u2", requesterIsOwner: false };

describe("replaceAvailability", () => {
  it("remplace les règles après validation", async () => {
    await replaceAvailability(deps(), {
      practitionerId: "p1", officeId: "o1", ...alice,
      rules: [
        { weekday: 1, startTime: "09:00", endTime: "12:00", roomId: "room-a" },
        { weekday: 2, startTime: "14:00", endTime: "18:00", roomId: "room-x" },
      ],
    });
    const s = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(s.availabilityRule).where(eq(s.availabilityRule.practitionerId, "p1"));
    expect(rows).toHaveLength(2);
  });

  it("refuse chevauchements, horaires invalides et salles interdites", async () => {
    const base = { practitionerId: "p2", officeId: "o1", ...bob };
    await expect(
      replaceAvailability(deps(), {
        ...base,
        rules: [
          { weekday: 1, startTime: "09:00", endTime: "12:00", roomId: "room-a" },
          { weekday: 1, startTime: "11:00", endTime: "13:00", roomId: "room-a" },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      replaceAvailability(deps(), {
        ...base, rules: [{ weekday: 1, startTime: "12:00", endTime: "09:00", roomId: "room-a" }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    // Bob n'a pas accès à la salle Exclusive.
    await expect(
      replaceAvailability(deps(), {
        ...base, rules: [{ weekday: 1, startTime: "09:00", endTime: "12:00", roomId: "room-x" }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("un praticien ne modifie pas les dispos d'un autre", async () => {
    await expect(
      replaceAvailability(deps(), {
        practitionerId: "p1", officeId: "o1", ...bob,
        rules: [{ weekday: 1, startTime: "09:00", endTime: "12:00", roomId: "room-a" }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("saveSessionType / deleteSessionType", () => {
  it("crée, modifie et désactive", async () => {
    const id = await saveSessionType(deps(), {
      practitionerId: "p2", officeId: "o1", ...bob,
      name: "Suivi", durationMin: 45, bufferAfterMin: 5,
    });
    const id2 = await saveSessionType(deps(), {
      practitionerId: "p2", officeId: "o1", ...bob, id,
      name: "Suivi long", durationMin: 60, bufferAfterMin: 5, active: false,
    });
    expect(id2).toBe(id);
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
    await expect(deleteSessionType(deps(), { id: "st1", ...alice, practitionerId: "p1", officeId: "o1" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("createException / deleteException", () => {
  it("crée un jour off et une ouverture exceptionnelle", async () => {
    await createException(deps(), {
      practitionerId: "p2", officeId: "o1", ...bob, date: "2026-12-25", kind: "off", fullDay: true,
    });
    await createException(deps(), {
      practitionerId: "p2", officeId: "o1", ...bob, date: "2026-09-19", kind: "extra",
      fullDay: false, startTime: "09:00", endTime: "12:00", roomId: "room-a",
    });
  });

  it("refuse date invalide et extra sans salle autorisée", async () => {
    await expect(
      createException(deps(), {
        practitionerId: "p2", officeId: "o1", ...bob, date: "2026-09-19", kind: "extra",
        fullDay: false, startTime: "09:00", endTime: "12:00", roomId: "room-x",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("suppression réservée au praticien ou owner", async () => {
    const s = await import("@/db/schema");
    const id = await createException(deps(), {
      practitionerId: "p2", officeId: "o1", ...bob, date: "2026-12-25", kind: "off", fullDay: true,
    });
    // Alice est owner : elle peut supprimer l'exception de Bob.
    await deleteException(deps(), { id, ...alice, practitionerId: "p2", officeId: "o1" });
    const { eq } = await import("drizzle-orm");
    expect(await db.select().from(s.exception).where(eq(s.exception.id, id))).toHaveLength(0);
  });
});

describe("updateProfile", () => {
  it("met à jour nom, bio et slug avec unicité", async () => {
    await updateProfile(deps(), {
      practitionerId: "p2", officeId: "o1", ...bob, displayName: "Bobby", bio: "Nouvelle bio", slug: "bobby",
    });
    await expect(
      updateProfile(deps(), { practitionerId: "p2", officeId: "o1", ...bob, displayName: "Bob", slug: "alice" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("saveRoom / deleteRoom", () => {
  it("crée et modifie une salle avec allowlist (owner uniquement)", async () => {
    const { saveRoom } = await import("@/lib/services/schedule");
    const id = await saveRoom(deps(), {
      officeId: "o1", requesterUserId: "u1", name: "Salle B", practitionerIds: ["p1", "p2"],
    });
    const id2 = await saveRoom(deps(), {
      officeId: "o1", requesterUserId: "u1", id, name: "Salle B", color: "#ff0000", practitionerIds: ["p1"],
    });
    expect(id2).toBe(id);
    // Bob (non-owner) ne peut pas gérer les salles.
    await expect(
      saveRoom(deps(), { officeId: "o1", requesterUserId: "u2", name: "X" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Praticien d'un autre cabinet refusé dans l'allowlist : on teste avec un id inconnu.
    await expect(
      saveRoom(deps(), { officeId: "o1", requesterUserId: "u1", name: "Y", practitionerIds: ["nope"] }),
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
    await expect(deleteRoom(deps(), { officeId: "o1", requesterUserId: "u1", id: "room-a" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    // Salle sans réservation : suppression OK.
    await deleteRoom(deps(), { officeId: "o1", requesterUserId: "u1", id: "room-x" });
  });
});

describe("updateOfficeSettings", () => {
  it("met à jour les réglages (owner uniquement)", async () => {
    const { updateOfficeSettings } = await import("@/lib/services/schedule");
    await updateOfficeSettings(deps(), {
      officeId: "o1", requesterUserId: "u1",
      name: "Nouveau nom", bookingLeadTimeMin: 60, cancelDeadlineHours: 48,
      reminderHoursBefore: 12, defaultBufferAfterMin: 5,
      enablePractitionerPages: true, enableOfficePage: true,
    });
    await expect(
      updateOfficeSettings(deps(), { officeId: "o1", requesterUserId: "u2", name: "Hack" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("saveSessionType paiement/validation", () => {
  it("accepte une séance payante avec prix, refuse sans prix", async () => {
    const { saveSessionType } = await import("@/lib/services/schedule");
    const id = await saveSessionType(
      { db, now: NOW },
      {
        practitionerId: "p2", officeId: "o1", requesterUserId: "u2", requesterIsOwner: false,
        name: "Payante", durationMin: 60, bufferAfterMin: 0,
        requiresPayment: true, priceCents: 5000, requiresValidation: true,
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
      saveSessionType(
        { db, now: NOW },
        {
          practitionerId: "p2", officeId: "o1", requesterUserId: "u2", requesterIsOwner: false,
          name: "Sans prix", durationMin: 60, bufferAfterMin: 0, requiresPayment: true,
        },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("saveSessionType nulls DB", () => {
  it("accepte les champs null renvoyés tels quels par le formulaire", async () => {
    const { saveSessionType } = await import("@/lib/services/schedule");
    // Reproduit le payload réel : description/priceCents à null.
    const id = await saveSessionType(
      { db, now: NOW },
      {
        practitionerId: "p2", officeId: "o1", requesterUserId: "u2", requesterIsOwner: false,
        id: undefined,
        name: "Soin 1", description: null as unknown as undefined,
        durationMin: 60, bufferAfterMin: 20, priceDisplay: "50",
        active: true, requiresPayment: false, priceCents: null as unknown as undefined,
        requiresValidation: true,
      },
    );
    expect(typeof id).toBe("string");
  });
});
