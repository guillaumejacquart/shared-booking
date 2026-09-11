import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDb } from "@/test/memory-db";
import type { Db } from "@/dal/types";
import {
  ConflictError,
  DeadlineError,
  NotFoundError,
  ValidationError,
} from "@/lib/services/errors";
import {
  cancelBooking,
  createBooking,
  getAvailableSlots,
  rescheduleBooking,
  type Deps,
} from "@/lib/services/bookings";
import type { OutgoingEmail } from "@/lib/email";

// Lundi 14 sept. 2026, 08:00 Paris = 06:00 UTC (heure d'été).
// Fenêtre lun. 09:00–13:00, séances 60min + buffer 10 → grille : 09:00, 10:10, 11:20.
// SLOT_A = 10:10 Paris, SLOT_B = 11:20 Paris.
const NOW = new Date("2026-09-14T06:00:00Z");
const SLOT_A = "2026-09-14T08:10:00.000Z";
const SLOT_B = "2026-09-14T09:20:00.000Z";
const BOB_10H = "2026-09-14T08:00:00.000Z"; // 10:00 Paris (grille de Bob, 60+0)

let db: Db;
let sent: OutgoingEmail[];

function deps(): Deps {
  return { db, now: NOW, sendEmail: async (e) => void sent.push(e) };
}

async function seed() {
  const s = await import("@/db/schema");
  await db.insert(s.user).values([
    { id: "u1", name: "Alice", email: "alice@example.com" },
    { id: "u2", name: "Bob", email: "bob@example.com" },
  ]);
  await db.insert(s.office).values({
    id: "o1",
    name: "Cabinet Test",
    slug: "cabinet-test",
    bookingLeadTimeMin: 120,
    cancelDeadlineHours: 24,
    reminderHoursBefore: 24,
    defaultBufferAfterMin: 0,
  });
  await db.insert(s.room).values([
    { id: "room-a", officeId: "o1", name: "Salle A", color: "#3b82f6" },
    { id: "room-b", officeId: "o1", name: "Salle B", color: "#22c55e" },
  ]);
  await db.insert(s.practitioner).values([
    { id: "p1", officeId: "o1", userId: "u1", displayName: "Alice", slug: "alice" },
    { id: "p2", officeId: "o1", userId: "u2", displayName: "Bob", slug: "bob" },
  ]);
  await db.insert(s.roomMember).values([
    { id: "rm1", roomId: "room-a", practitionerId: "p1" },
    { id: "rm2", roomId: "room-a", practitionerId: "p2" },
    { id: "rm3", roomId: "room-b", practitionerId: "p1" },
  ]);
  await db.insert(s.sessionType).values([
    { id: "st1", practitionerId: "p1", name: "Séance 60min", durationMin: 60, bufferAfterMin: 10 },
    { id: "st2", practitionerId: "p2", name: "Suivi 60min", durationMin: 60, bufferAfterMin: 0 },
    { id: "st3", practitionerId: "p1", name: "À valider", durationMin: 60, bufferAfterMin: 10, requiresValidation: true },
    { id: "st4", practitionerId: "p2", name: "À valider", durationMin: 60, bufferAfterMin: 0, requiresValidation: true },
  ]);
  await db.insert(s.member).values([
    { id: "m1", officeId: "o1", userId: "u1", role: "owner" },
    { id: "m2", officeId: "o1", userId: "u2", role: "practitioner" },
  ]);
  await db.insert(s.availabilityRule).values([
    { id: "r1", practitionerId: "p1", weekday: 1, startTime: "09:00", endTime: "13:00", roomId: "room-a" },
    { id: "r2", practitionerId: "p2", weekday: 1, startTime: "09:00", endTime: "13:00", roomId: "room-a" },
  ]);
}

const patient = {
  patientFirstName: "Jean",
  patientLastName: "Dupont",
  patientEmail: "jean@example.com",
  consent: true as const,
};

beforeEach(async () => {
  db = createMemoryDb();
  sent = [];
  await seed();
});

describe("getAvailableSlots", () => {
  it("retourne les créneaux futurs d'un type de séance", async () => {
    const slots = await getAvailableSlots(deps(), {
      practitionerSlug: "alice",
      sessionTypeId: "st1",
      fromDate: "2026-09-14",
      days: 1,
    });
    // 09:00 passé (lead time 2h depuis 08:00) → 10:10 et 11:20.
    expect(slots.map((s) => s.startAt)).toEqual([SLOT_A, SLOT_B]);
    // La salle n'est pas exposée au public.
    expect(slots[0]).not.toHaveProperty("roomId");
  });

  it("404 sur praticien inconnu, inactif ou pages désactivées", async () => {
    const s = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await expect(
      getAvailableSlots(deps(), { practitionerSlug: "nope", sessionTypeId: "st1", fromDate: "2026-09-14", days: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await db.update(s.practitioner).set({ active: false }).where(eq(s.practitioner.id, "p1"));
    await expect(
      getAvailableSlots(deps(), { practitionerSlug: "alice", sessionTypeId: "st1", fromDate: "2026-09-14", days: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await db.update(s.practitioner).set({ active: true }).where(eq(s.practitioner.id, "p1"));
    await db.update(s.office).set({ enablePractitionerPages: false }).where(eq(s.office.id, "o1"));
    await expect(
      getAvailableSlots(deps(), { practitionerSlug: "alice", sessionTypeId: "st1", fromDate: "2026-09-14", days: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("404 sur type de séance inconnu ou d'un autre praticien", async () => {
    await expect(
      getAvailableSlots(deps(), { practitionerSlug: "alice", sessionTypeId: "st2", fromDate: "2026-09-14", days: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("createBooking", () => {
  it("réserve un créneau et envoie la confirmation", async () => {
    const res = await createBooking(deps(), {
      practitionerSlug: "alice",
      sessionTypeId: "st1",
      startAt: SLOT_A,
      ...patient,
    });
    expect(res.status).toBe("confirmed");
    expect(res.startAt).toBe(SLOT_A);
    expect(res.cancelToken).toHaveLength(64);
    expect(res.rescheduleToken).toHaveLength(64);
    expect(res.cancelToken).not.toBe(res.rescheduleToken);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("jean@example.com");
    expect(sent[0].ics).toBeDefined();
  });

  it("refuse un créneau déjà pris (même praticien)", async () => {
    await createBooking(deps(), {
      practitionerSlug: "alice", sessionTypeId: "st1", startAt: SLOT_A, ...patient,
    });
    await expect(
      createBooking(deps(), {
        practitionerSlug: "alice", sessionTypeId: "st1", startAt: SLOT_A,
        ...patient, patientEmail: "autre@example.com",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuse un créneau en conflit de salle (Bob en salle A à la même heure)", async () => {
    // Alice 10:10–11:10 + 10min buffer en salle A → Bob ne peut plus prendre 10:00 en A.
    await createBooking(deps(), {
      practitionerSlug: "alice", sessionTypeId: "st1", startAt: SLOT_A, ...patient,
    });
    await expect(
      createBooking(deps(), {
        practitionerSlug: "bob", sessionTypeId: "st2", startAt: BOB_10H, ...patient,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuse hors délai de réservation (lead time)", async () => {
    // 09:00 Paris = 07:00Z, soit 1h après NOW → sous le lead time de 2h.
    // (consentement et format d'email : validés par le schéma, voir schemas.test.ts)
    await expect(
      createBooking(deps(), {
        practitionerSlug: "alice", sessionTypeId: "st1", startAt: "2026-09-14T07:00:00.000Z", ...patient,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("limite à 3 réservations futures par email et par praticien", async () => {
    const early = { ...deps(), now: new Date("2026-09-01T06:00:00Z") };
    for (const day of ["2026-09-14", "2026-09-21", "2026-09-28"]) {
      await createBooking(early, {
        practitionerSlug: "alice", sessionTypeId: "st1",
        startAt: `${day}T07:00:00.000Z`, ...patient, // 09:00 Paris
      });
    }
    await expect(
      createBooking(early, {
        practitionerSlug: "alice", sessionTypeId: "st1",
        startAt: "2026-10-05T07:00:00.000Z", ...patient,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("cancelBooking", () => {
  it("le patient annule dans les délais, le praticien est notifié", async () => {
    const early = { ...deps(), now: new Date("2026-09-12T06:00:00Z") };
    const toCancel = await createBooking(early, {
      practitionerSlug: "alice", sessionTypeId: "st1", startAt: SLOT_A,
      ...patient, patientEmail: "marie@example.com",
    });
    await cancelBooking(early, { token: toCancel.cancelToken, by: "patient" });
    expect(sent.at(-1)?.to).toBe("alice@example.com");
  });

  it("le patient ne peut pas annuler après la deadline (24h)", async () => {
    const res = await createBooking(
      { ...deps(), now: new Date("2026-09-12T06:00:00Z") },
      { practitionerSlug: "alice", sessionTypeId: "st1", startAt: SLOT_A, ...patient },
    );
    // NOW = RDV − ~2h → après la deadline.
    await expect(cancelBooking(deps(), { token: res.cancelToken, by: "patient" })).rejects.toBeInstanceOf(
      DeadlineError,
    );
  });

  it("le praticien annule toujours, avec motif obligatoire", async () => {
    const res = await createBooking(
      { ...deps(), now: new Date("2026-09-12T06:00:00Z") },
      { practitionerSlug: "alice", sessionTypeId: "st1", startAt: SLOT_A, ...patient },
    );
    await expect(
      cancelBooking(deps(), { token: res.cancelToken, by: "practitioner" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await cancelBooking(deps(), {
      token: res.cancelToken, by: "practitioner", reason: "Imprévu",
    });
    expect(sent.at(-1)?.to).toBe("jean@example.com");
  });

  it("annuler deux fois est idempotent", async () => {
    const early = { ...deps(), now: new Date("2026-09-12T06:00:00Z") };
    const res = await createBooking(early, {
      practitionerSlug: "alice", sessionTypeId: "st1", startAt: SLOT_A, ...patient,
    });
    await cancelBooking(early, { token: res.cancelToken, by: "patient" });
    const again = await cancelBooking(early, { token: res.cancelToken, by: "patient" });
    expect(again.status).toBe("cancelled");
  });
});

describe("rescheduleBooking", () => {
  it("déplace la réservation et libère l'ancien créneau", async () => {
    const early = { ...deps(), now: new Date("2026-09-12T06:00:00Z") };
    const res = await createBooking(early, {
      practitionerSlug: "alice", sessionTypeId: "st1", startAt: SLOT_A, ...patient,
    });
    await rescheduleBooking(early, { token: res.rescheduleToken, newStartAt: SLOT_B });
    // L'ancien créneau est de nouveau réservable…
    const slots = await getAvailableSlots(early, {
      practitionerSlug: "alice", sessionTypeId: "st1", fromDate: "2026-09-14", days: 1,
    });
    expect(slots.map((s) => s.startAt)).toContain(SLOT_A);
    expect(slots.map((s) => s.startAt)).not.toContain(SLOT_B);
  });

  it("refuse vers un créneau occupé", async () => {
    const early = { ...deps(), now: new Date("2026-09-12T06:00:00Z") };
    await createBooking(early, {
      practitionerSlug: "alice", sessionTypeId: "st1", startAt: SLOT_B,
      ...patient, patientEmail: "autre@example.com",
    });
    const res = await createBooking(early, {
      practitionerSlug: "alice", sessionTypeId: "st1", startAt: SLOT_A, ...patient,
    });
    await expect(
      rescheduleBooking(early, { token: res.rescheduleToken, newStartAt: SLOT_B }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("validateBooking", () => {
  it("le praticien valide : confirmé + email de confirmation", async () => {
    const { validateBooking } = await import("@/lib/services/bookings");
    const { ForbiddenError } = await import("@/lib/services/errors");
    void ForbiddenError;
    const res = await createBooking(deps(), {
      practitionerSlug: "alice", sessionTypeId: "st3", startAt: SLOT_A, ...patient,
    });
    expect(res.status).toBe("pending");
    expect(sent).toHaveLength(2); // accusé patient + demande au praticien
    expect(sent[0].subject).toContain("Demande reçue");
    expect(sent[0].to).toBe("jean@example.com");
    expect(sent[1].to).toBe("alice@example.com");
    expect(sent[1].subject).toContain("À valider");

    const out = await validateBooking(deps(), {
      bookingId: res.id, requesterUserId: "u1", accept: true,
    });
    expect(out.status).toBe("confirmed");
    expect(sent).toHaveLength(3);
    expect(sent[2].subject).toContain("Confirmation");
  });

  it("le praticien refuse avec motif : annulé + patient notifié", async () => {
    const { validateBooking } = await import("@/lib/services/bookings");
    const res = await createBooking(deps(), {
      practitionerSlug: "alice", sessionTypeId: "st3", startAt: SLOT_A, ...patient,
    });
    await expect(
      validateBooking(deps(), { bookingId: res.id, requesterUserId: "u1", accept: false }),
    ).rejects.toBeInstanceOf(ValidationError);
    const out = await validateBooking(deps(), {
      bookingId: res.id, requesterUserId: "u1", accept: false, reason: "Complet",
    });
    expect(out.status).toBe("cancelled");
    expect(sent.at(-1)?.to).toBe("jean@example.com");
  });

  it("un tiers ne peut pas valider, ni valider deux fois", async () => {
    const { validateBooking } = await import("@/lib/services/bookings");
    const { ConflictError, ForbiddenError } = await import("@/lib/services/errors");
    const res = await createBooking(deps(), {
      practitionerSlug: "alice", sessionTypeId: "st3", startAt: SLOT_A, ...patient,
    });
    // Bob n'est ni le praticien ni owner.
    await expect(
      validateBooking(deps(), { bookingId: res.id, requesterUserId: "u2", accept: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await validateBooking(deps(), { bookingId: res.id, requesterUserId: "u1", accept: true });
    await expect(
      validateBooking(deps(), { bookingId: res.id, requesterUserId: "u1", accept: true }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("le owner peut valider pour un autre praticien", async () => {
    const { validateBooking } = await import("@/lib/services/bookings");
    const res = await createBooking(deps(), {
      practitionerSlug: "bob", sessionTypeId: "st4", startAt: BOB_10H, ...patient,
    });
    const out = await validateBooking(deps(), {
      bookingId: res.id, requesterUserId: "u1", accept: true,
    });
    expect(out.status).toBe("confirmed");
  });
});
