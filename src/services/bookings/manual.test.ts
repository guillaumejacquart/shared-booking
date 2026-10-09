import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDb } from "@/test/memory-db";
import { setConnection } from "@/dal/connection";
import type { Db } from "@/dal/types";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/services/errors";
import {
  createManualBooking,
  getManualFormData,
  getRoomAvailability,
} from "@/services/bookings/manual";
import type { OutgoingEmail } from "@/lib/email";
import { fixedClock } from "@/lib/ports";
import type { Ports } from "@/lib/ports";
import { testPorts } from "@/test/ports";
import { seedSingleVariant } from "@/test/session-types";

// Lundi 14 sept. 2026, 08:00 Paris = 06:00 UTC.
// AFTERNOON = 14:00 Paris (hors fenêtre 09:00–13:00 : prouve l'horaire libre).
const NOW = new Date("2026-09-14T06:00:00Z");
const AFTERNOON = "2026-09-14T12:00:00.000Z";

let db: Db;
let sent: OutgoingEmail[];

function ports(): Ports {
  return testPorts({ clock: fixedClock(NOW), sendEmail: async (email) => void sent.push(email) });
}

async function seed() {
  const schema = await import("@/db/schema");
  await db.insert(schema.user).values([
    { id: "u1", name: "Alice", email: "alice@example.com" },
    { id: "u2", name: "Bob", email: "bob@example.com" },
  ]);
  await db.insert(schema.office).values({
    id: "o1",
    name: "Cabinet Test",
    slug: "cabinet-test",
    bookingLeadTimeMin: 120,
    cancelDeadlineHours: 24,
    reminderHoursBefore: 24,
    defaultBufferAfterMin: 0,
  });
  await db.insert(schema.room).values([
    { id: "room-a", officeId: "o1", name: "Salle A", color: "#3b82f6" },
    { id: "room-b", officeId: "o1", name: "Salle B", color: "#22c55e" },
  ]);
  await db.insert(schema.practitioner).values([
    { id: "p1", officeId: "o1", userId: "u1", displayName: "Alice", slug: "alice", slotStepMin: 15 },
    { id: "p2", officeId: "o1", userId: "u2", displayName: "Bob", slug: "bob", slotStepMin: 15 },
  ]);
  await db.insert(schema.roomMember).values([
    { id: "rm1", roomId: "room-a", practitionerId: "p1" },
    { id: "rm2", roomId: "room-a", practitionerId: "p2" },
    { id: "rm3", roomId: "room-b", practitionerId: "p1" },
  ]);
  await seedSingleVariant(db, {
    id: "st1",
    practitionerId: "p1",
    name: "Séance 60min",
    durationMin: 60,
    bufferAfterMin: 10,
  });
  await seedSingleVariant(db, {
    id: "st3",
    practitionerId: "p1",
    name: "À valider",
    durationMin: 60,
    bufferAfterMin: 10,
    requiresValidation: true,
  });
  await seedSingleVariant(db, {
    id: "st2",
    practitionerId: "p2",
    name: "Suivi 60min",
    durationMin: 60,
    bufferAfterMin: 0,
  });
  await db.insert(schema.member).values([
    { id: "m1", officeId: "o1", userId: "u1", role: "owner" },
    { id: "m2", officeId: "o1", userId: "u2", role: "practitioner" },
  ]);
  await db.insert(schema.availabilityRule).values([
    { id: "r1", practitionerId: "p1", weekday: 1, startTime: "09:00", endTime: "13:00" },
  ]);
}

const patient = {
  patientFirstName: "Jean",
  patientLastName: "Dupont",
  patientEmail: "jean@example.com",
};

function manualInput(overrides: Record<string, unknown> = {}) {
  return {
    requesterUserId: "u1",
    sessionTypeId: "st1",
    startAt: AFTERNOON,
    roomId: "room-a",
    overrideOff: false,
    origin: "manual" as const,
    ...patient,
    ...overrides,
  };
}

async function bookingOrigin(bookingId: string): Promise<string | null> {
  const schema = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const rows = await db.select().from(schema.booking).where(eq(schema.booking.id, bookingId));
  return rows[0]?.origin ?? null;
}

beforeEach(async () => {
  db = createMemoryDb();
  setConnection(db);
  sent = [];
  await seed();
});

describe("createManualBooking", () => {
  it("crée un RDV confirmé hors grille et envoie la confirmation", async () => {
    const res = await createManualBooking(ports(), manualInput());
    expect(res.status).toBe("confirmed");
    expect(res.requiresPayment).toBe(false);
    expect(res.startAt).toBe(AFTERNOON);
    expect(res.endAt).toBe("2026-09-14T13:00:00.000Z");
    expect(await bookingOrigin(res.id)).toBe("manual");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("jean@example.com");
    expect(sent[0].subject).toContain("Confirmation");
  });

  it("confirme direct même si la séance exige une validation", async () => {
    const res = await createManualBooking(ports(), manualInput({ sessionTypeId: "st3" }));
    expect(res.status).toBe("confirmed");
    expect(sent).toHaveLength(1);
  });

  it("ignore le lead time et le quota par email", async () => {
    // Dans 30 min (sous le lead time de 2h) : réservable en manuel.
    const soon = new Date(NOW.getTime() + 30 * 60_000).toISOString();
    const first = await createManualBooking(ports(), manualInput({ startAt: soon }));
    expect(first.status).toBe("confirmed");
    // 4 RDV futurs avec le même email : pas de quota en manuel.
    const days = ["2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"];
    for (const day of days) {
      const created = await createManualBooking(
        ports(),
        manualInput({ startAt: `${day}T12:00:00.000Z`, roomId: "room-b" }),
      );
      expect(created.status).toBe("confirmed");
    }
  });

  it("refuse si le praticien est déjà occupé", async () => {
    await createManualBooking(ports(), manualInput());
    await expect(
      createManualBooking(
        ports(),
        manualInput({ startAt: AFTERNOON, roomId: "room-b", patientEmail: "autre@example.com" }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuse si la salle est déjà occupée (autre praticien)", async () => {
    await createManualBooking(ports(), manualInput());
    await expect(
      createManualBooking(ports(), {
        requesterUserId: "u2",
        sessionTypeId: "st2",
        startAt: AFTERNOON,
        roomId: "room-a",
        overrideOff: false,
        origin: "manual" as const,
        patientFirstName: "Marie",
        patientLastName: "Martin",
        patientEmail: "marie@example.com",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    // …mais Bob peut réserver la même heure dans une salle qu'Alice utilise aussi,
    // tant qu'Alice n'y est pas : ici room-b n'est pas autorisée à Bob → Forbidden.
    await expect(
      createManualBooking(ports(), {
        requesterUserId: "u2",
        sessionTypeId: "st2",
        startAt: AFTERNOON,
        roomId: "room-b",
        overrideOff: false,
        origin: "manual" as const,
        patientFirstName: "Marie",
        patientLastName: "Martin",
        patientEmail: "marie@example.com",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuse dans le passé et sur salle inconnue ou séance d'un autre", async () => {
    await expect(
      createManualBooking(ports(), manualInput({ startAt: "2026-09-13T12:00:00.000Z" })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(createManualBooking(ports(), manualInput({ roomId: "nope" }))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(createManualBooking(ports(), manualInput({ sessionTypeId: "st2" }))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("bloque sur un congé, sauf override explicite", async () => {
    const schema = await import("@/db/schema");
    await db.insert(schema.exception).values({
      id: "ex1",
      practitionerId: "p1",
      date: "2026-09-14",
      kind: "off",
      startTime: null,
      endTime: null,
      fullDay: true,
      roomId: null,
      reason: "Vacances",
    });
    await expect(createManualBooking(ports(), manualInput())).rejects.toBeInstanceOf(ConflictError);
    const forced = await createManualBooking(ports(), manualInput({ overrideOff: true }));
    expect(forced.status).toBe("confirmed");
  });
});

describe("getRoomAvailability", () => {
  it("signale praticien libre et salles libres", async () => {
    const availability = await getRoomAvailability(ports(), {
      requesterUserId: "u1",
      sessionTypeId: "st1",
      startAt: AFTERNOON,
    });
    expect(availability.practitioner.status).toBe("free");
    expect(availability.rooms.map((room) => room.id)).toEqual(["room-a", "room-b"]);
    expect(availability.rooms.every((room) => room.free)).toBe(true);
  });

  it("signale praticien occupé et salle prise après une résa", async () => {
    await createManualBooking(ports(), manualInput());
    const availability = await getRoomAvailability(ports(), {
      requesterUserId: "u1",
      sessionTypeId: "st1",
      startAt: AFTERNOON,
    });
    expect(availability.practitioner.status).toBe("busy");
    expect(availability.rooms.find((room) => room.id === "room-a")?.free).toBe(false);
    expect(availability.rooms.find((room) => room.id === "room-b")?.free).toBe(true);
  });

  it("signale un congé avec son motif", async () => {
    const schema = await import("@/db/schema");
    await db.insert(schema.exception).values({
      id: "ex1",
      practitionerId: "p1",
      date: "2026-09-14",
      kind: "off",
      startTime: null,
      endTime: null,
      fullDay: true,
      roomId: null,
      reason: "Vacances",
    });
    const availability = await getRoomAvailability(ports(), {
      requesterUserId: "u1",
      sessionTypeId: "st1",
      startAt: AFTERNOON,
    });
    expect(availability.practitioner.status).toBe("off");
    expect(availability.practitioner.reason).toBe("Vacances");
  });
});

describe("getManualFormData", () => {
  it("retourne séances avec variantes et salles autorisées", async () => {
    const form = await getManualFormData("u1");
    expect(form.timezone).toBe("Europe/Paris");
    expect(form.sessionTypes.map((entry) => entry.id).sort()).toEqual(["st1", "st3"]);
    expect(form.sessionTypes[0].variants[0]).toMatchObject({ durationMin: 60, bufferAfterMin: 10 });
    expect(form.rooms.map((room) => room.id)).toEqual(["room-a", "room-b"]);
  });
});
