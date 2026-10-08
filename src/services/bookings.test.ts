import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDb } from "@/test/memory-db";
import { setConnection } from "@/dal/connection";
import type { Db } from "@/dal/types";
import {
  ConflictError,
  DeadlineError,
  NotFoundError,
  ValidationError,
} from "@/services/errors";
import {
  cancelBooking,
  createBooking,
  getAvailableSlots,
  rescheduleBooking,
  type Ports,
} from "@/services/bookings";
import type { OutgoingEmail } from "@/lib/email";
import { fixedClock } from "@/lib/ports";
import { testPorts } from "@/test/ports";
import { seedSingleVariant } from "@/test/session-types";

// Lundi 14 sept. 2026, 08:00 Paris = 06:00 UTC (heure d'été).
// Fenêtre lun. 09:00–13:00, séances 60min + buffer 10, pas 15min → grille
// coulissante : 09:00, 09:15, …, 12:00.
// SLOT_A = 10:15 Paris, SLOT_B = 11:30 Paris (sans chevauchement de buffer).
const NOW = new Date("2026-09-14T06:00:00Z");
const SLOT_A = "2026-09-14T08:15:00.000Z";
const SLOT_B = "2026-09-14T09:30:00.000Z";
const BOB_10H = "2026-09-14T08:00:00.000Z"; // 10:00 Paris (grille de Bob, 60+0, pas 15)

let db: Db;
let sent: OutgoingEmail[];

function ports(): Ports {
  return testPorts({ clock: fixedClock(NOW), sendEmail: async (email) => void sent.push(email) });
}

async function seed() {
  const s = await import("@/db/schema");
  await db.insert(s.user).values([
    { id: "u1", name: "Alice", email: "alice@example.com" },
    { id: "u2", name: "Bob", email: "bob@example.com" },
    { id: "u3", name: "Carol", email: "carol@example.com" },
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
    { id: "p1", officeId: "o1", userId: "u1", displayName: "Alice", slug: "alice", slotStepMin: 15 },
    { id: "p2", officeId: "o1", userId: "u2", displayName: "Bob", slug: "bob", slotStepMin: 15 },
    { id: "p3", officeId: "o1", userId: "u3", displayName: "Carol", slug: "carol", slotStepMin: 15 },
  ]);
  await db.insert(s.roomMember).values([
    { id: "rm1", roomId: "room-a", practitionerId: "p1" },
    { id: "rm2", roomId: "room-a", practitionerId: "p2" },
    { id: "rm3", roomId: "room-b", practitionerId: "p1" },
    { id: "rm4", roomId: "room-b", practitionerId: "p3" },
  ]);
  await seedSingleVariant(db, { id: "st1", practitionerId: "p1", name: "Séance 60min", durationMin: 60, bufferAfterMin: 10 });
  await seedSingleVariant(db, { id: "st2", practitionerId: "p2", name: "Suivi 60min", durationMin: 60, bufferAfterMin: 0 });
  await seedSingleVariant(db, { id: "st3", practitionerId: "p1", name: "À valider", durationMin: 60, bufferAfterMin: 10, requiresValidation: true });
  await seedSingleVariant(db, { id: "st4", practitionerId: "p2", name: "À valider", durationMin: 60, bufferAfterMin: 0, requiresValidation: true });
  await seedSingleVariant(db, { id: "st5", practitionerId: "p3", name: "Soin 60min", durationMin: 60, bufferAfterMin: 0 });
  await seedSingleVariant(db, { id: "st6", practitionerId: "p1", name: "Massage (salle B)", durationMin: 60, bufferAfterMin: 10 });
  // st6 restreint à la salle B ; les autres types restent compatibles partout.
  await db.insert(s.sessionTypeRoom).values([{ id: "str1", sessionTypeId: "st6", roomId: "room-b" }]);
  await db.insert(s.member).values([
    { id: "m1", officeId: "o1", userId: "u1", role: "owner" },
    { id: "m2", officeId: "o1", userId: "u2", role: "practitioner" },
  ]);
  await db.insert(s.availabilityRule).values([
    { id: "r1", practitionerId: "p1", weekday: 1, startTime: "09:00", endTime: "13:00" },
    { id: "r2", practitionerId: "p2", weekday: 1, startTime: "09:00", endTime: "13:00" },
    { id: "r3", practitionerId: "p3", weekday: 1, startTime: "09:00", endTime: "13:00" },
  ]);
}

const patient = {
  patientFirstName: "Jean",
  patientLastName: "Dupont",
  patientEmail: "jean@example.com",
  consent: true as const,
};

beforeEach(async () => {
  db = createMemoryDb();  setConnection(db);
  sent = [];
  await seed();
});

describe("getAvailableSlots", () => {
  it("retourne les créneaux futurs d'un type de séance", async () => {
    const slots = await getAvailableSlots(ports(), {
      practitionerSlug: "alice",
      sessionTypeId: "st1",
      fromDate: "2026-09-14",
      days: 1,
    });
    // 09:00–09:45 passés (lead time 2h depuis 08:00) → 10:00 à 12:00 au pas de 15min.
    expect(slots.map((s) => s.startAt)).toEqual([
      "2026-09-14T08:00:00.000Z",
      SLOT_A,
      "2026-09-14T08:30:00.000Z",
      "2026-09-14T08:45:00.000Z",
      "2026-09-14T09:00:00.000Z",
      "2026-09-14T09:15:00.000Z",
      SLOT_B,
      "2026-09-14T09:45:00.000Z",
      "2026-09-14T10:00:00.000Z",
    ]);
    // La salle n'est pas exposée au public.
    expect(slots[0]).not.toHaveProperty("roomId");
  });

  it("404 sur praticien inconnu, inactif ou pages désactivées", async () => {
    const s = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await expect(
      getAvailableSlots(ports(), { practitionerSlug: "nope", sessionTypeId: "st1", fromDate: "2026-09-14", days: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await db.update(s.practitioner).set({ active: false }).where(eq(s.practitioner.id, "p1"));
    await expect(
      getAvailableSlots(ports(), { practitionerSlug: "alice", sessionTypeId: "st1", fromDate: "2026-09-14", days: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await db.update(s.practitioner).set({ active: true }).where(eq(s.practitioner.id, "p1"));
    await db.update(s.office).set({ enablePractitionerPages: false }).where(eq(s.office.id, "o1"));
    await expect(
      getAvailableSlots(ports(), { practitionerSlug: "alice", sessionTypeId: "st1", fromDate: "2026-09-14", days: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("404 sur type de séance inconnu ou d'un autre praticien", async () => {
    await expect(
      getAvailableSlots(ports(), { practitionerSlug: "alice", sessionTypeId: "st2", fromDate: "2026-09-14", days: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("createBooking", () => {
  it("réserve un créneau et envoie la confirmation", async () => {
    const res = await createBooking(ports(), {
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

  it("l'email de confirmation annonce le règlement sur place (moyens + précision)", async () => {
    const s = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await db
      .update(s.practitioner)
      .set({
        onsitePaymentMethods: '["especes","carte"]',
        onsitePaymentNote: "Appoint apprécié",
      })
      .where(eq(s.practitioner.id, "p1"));
    await db
      .update(s.sessionTypeVariant)
      .set({ priceDisplay: "60 €" })
      .where(eq(s.sessionTypeVariant.sessionTypeId, "st1"));
    await createBooking(ports(), {
      practitionerSlug: "alice",
      sessionTypeId: "st1",
      startAt: SLOT_A,
      ...patient,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("Règlement sur place : 60 € (espèces et carte bancaire).");
    expect(sent[0].text).toContain("Précision : Appoint apprécié");
    expect(sent[0].html).toContain("Règlement sur place");
  });

  it("sans tarif ni moyens configurés, l'email ne parle pas de règlement", async () => {
    await createBooking(ports(), {
      practitionerSlug: "alice",
      sessionTypeId: "st1",
      startAt: SLOT_A,
      ...patient,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].text).not.toContain("Règlement sur place");
    expect(sent[0].html).not.toContain("Règlement sur place");
  });

  it("l'email de confirmation porte ICS + lien Google issus de la même description", async () => {
    const res = await createBooking(ports(), {
      practitionerSlug: "alice",
      sessionTypeId: "st1",
      startAt: SLOT_A,
      ...patient,
    });
    const email = sent[0];
    const title = "Séance 60min — Alice";
    const location = "Cabinet Test"; // sans adresse dans le seed
    // Même titre et même lieu dans l'ICS et dans le lien Google.
    expect(email.ics?.content).toContain(`SUMMARY:${title}`);
    expect(email.ics?.content).toContain(`LOCATION:${location}`);
    const googleUrl = new URL(
      email.text.split("Ajouter à Google Agenda : ")[1].split("\n")[0],
    );
    expect(googleUrl.searchParams.get("text")).toBe(title);
    expect(googleUrl.searchParams.get("location")).toBe(location);
    expect(googleUrl.searchParams.get("dates")).toBe("20260914T081500Z/20260914T091500Z");
    // Le lien de gestion voyage aussi dans la description Google.
    expect(googleUrl.searchParams.get("details")).toContain(res.cancelToken);
  });

  it("pousse la réservation vers Google quand le push est activé", async () => {
    const s = await import("@/db/schema");
    await db.insert(s.practitionerGoogle).values({ practitionerId: "p1", syncEnabled: true });
    const calls: string[] = [];
    const withGoogle = {
      ...ports(),
      googleCalendar: {
        forUser: async () => ({
          insertEvent: async () => {
            calls.push("insert");
            return { id: "evt-1" };
          },
          patchEvent: async () => void calls.push("patch"),
          deleteEvent: async () => void calls.push("delete"),
          listCalendars: async () => [],
        }),
      },
    };
    const res = await createBooking(withGoogle, {
      practitionerSlug: "alice",
      sessionTypeId: "st1",
      startAt: SLOT_A,
      ...patient,
    });
    expect(calls).toEqual(["insert"]);
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(s.booking).where(eq(s.booking.id, res.id));
    expect(rows[0].googleEventId).toBe("evt-1");
    expect(rows[0].googleSyncStatus).toBe("ok");
  });

  it("attribue la première salle libre (ordre sortOrder puis nom)", async () => {
    const res = await createBooking(ports(), {
      practitionerSlug: "alice", sessionTypeId: "st1", startAt: SLOT_A, ...patient,
    });
    const s = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(s.booking).where(eq(s.booking.id, res.id));
    expect(rows[0].roomId).toBe("room-a");
  });

  it("bascule sur une autre salle libre quand la première est occupée", async () => {
    // Bob (salle A uniquement) occupe 10h00–11h00 en A → Alice bascule en B.
    await createBooking(ports(), {
      practitionerSlug: "bob", sessionTypeId: "st2", startAt: BOB_10H, ...patient,
      patientEmail: "bob-patient@example.com",
    });
    const res = await createBooking(ports(), {
      practitionerSlug: "alice", sessionTypeId: "st1", startAt: SLOT_A, ...patient,
    });
    const s = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(s.booking).where(eq(s.booking.id, res.id));
    expect(rows[0].roomId).toBe("room-b");
  });

  it("refuse un créneau déjà pris (même praticien)", async () => {
    await createBooking(ports(), {
      practitionerSlug: "alice", sessionTypeId: "st1", startAt: SLOT_A, ...patient,
    });
    await expect(
      createBooking(ports(), {
        practitionerSlug: "alice", sessionTypeId: "st1", startAt: SLOT_A,
        ...patient, patientEmail: "autre@example.com",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("une séance restreinte réserve dans ses salles compatibles", async () => {
    const res = await createBooking(ports(), {
      practitionerSlug: "alice", sessionTypeId: "st6", startAt: SLOT_A, ...patient,
    });
    expect(res.status).toBe("confirmed");
    const s = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(s.booking).where(eq(s.booking.id, res.id));
    expect(rows[0].roomId).toBe("room-b");
  });

  it("refuse si la seule salle compatible est occupée (autre salle libre)", async () => {
    // Carol (salle B uniquement) occupe 10h00–11h00 en B → le massage d'Alice
    // (restreint à B) n'a plus de salle, bien que A soit libre.
    await createBooking(ports(), {
      practitionerSlug: "carol", sessionTypeId: "st5", startAt: "2026-09-14T08:00:00.000Z",
      ...patient, patientEmail: "carol-patient@example.com",
    });
    await expect(
      createBooking(ports(), {
        practitionerSlug: "alice", sessionTypeId: "st6", startAt: SLOT_A, ...patient,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    // …alors que la séance non restreinte reste réservable (en A).
    const res = await createBooking(ports(), {
      practitionerSlug: "alice", sessionTypeId: "st1", startAt: SLOT_A,
      ...patient, patientEmail: "autre@example.com",
    });
    expect(res.status).toBe("confirmed");
  });

  it("refuse un créneau en conflit de salle (Bob en salle A à la même heure)", async () => {
    // Alice 10:15–11:15 + 10min buffer en salle A → Bob ne peut plus prendre 10:00 en A.
    await createBooking(ports(), {
      practitionerSlug: "alice", sessionTypeId: "st1", startAt: SLOT_A, ...patient,
    });
    await expect(
      createBooking(ports(), {
        practitionerSlug: "bob", sessionTypeId: "st2", startAt: BOB_10H, ...patient,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuse hors délai de réservation (lead time)", async () => {
    // 09:00 Paris = 07:00Z, soit 1h après NOW → sous le lead time de 2h.
    // (consentement et format d'email : validés par le schéma, voir schemas.test.ts)
    await expect(
      createBooking(ports(), {
        practitionerSlug: "alice", sessionTypeId: "st1", startAt: "2026-09-14T07:00:00.000Z", ...patient,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("limite à 3 réservations futures par email et par praticien", async () => {
    const early = { ...ports(), clock: fixedClock(new Date("2026-09-01T06:00:00Z")) };
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
    const early = { ...ports(), clock: fixedClock(new Date("2026-09-12T06:00:00Z")) };
    const toCancel = await createBooking(early, {
      practitionerSlug: "alice", sessionTypeId: "st1", startAt: SLOT_A,
      ...patient, patientEmail: "marie@example.com",
    });
    await cancelBooking(early, { token: toCancel.cancelToken, by: "patient" });
    expect(sent.at(-1)?.to).toBe("alice@example.com");
  });

  it("le patient ne peut pas annuler après la deadline (24h)", async () => {
    const res = await createBooking(
      { ...ports(), clock: fixedClock(new Date("2026-09-12T06:00:00Z")) },
      { practitionerSlug: "alice", sessionTypeId: "st1", startAt: SLOT_A, ...patient },
    );
    // NOW = RDV − ~2h → après la deadline.
    await expect(cancelBooking(ports(), { token: res.cancelToken, by: "patient" })).rejects.toBeInstanceOf(
      DeadlineError,
    );
  });

  it("le praticien annule toujours, avec motif obligatoire", async () => {
    const res = await createBooking(
      { ...ports(), clock: fixedClock(new Date("2026-09-12T06:00:00Z")) },
      { practitionerSlug: "alice", sessionTypeId: "st1", startAt: SLOT_A, ...patient },
    );
    await expect(
      cancelBooking(ports(), { token: res.cancelToken, by: "practitioner" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await cancelBooking(ports(), {
      token: res.cancelToken, by: "practitioner", reason: "Imprévu",
    });
    expect(sent.at(-1)?.to).toBe("jean@example.com");
  });

  it("annuler deux fois est idempotent", async () => {
    const early = { ...ports(), clock: fixedClock(new Date("2026-09-12T06:00:00Z")) };
    const res = await createBooking(early, {
      practitionerSlug: "alice", sessionTypeId: "st1", startAt: SLOT_A, ...patient,
    });
    await cancelBooking(early, { token: res.cancelToken, by: "patient" });
    const again = await cancelBooking(early, { token: res.cancelToken, by: "patient" });
    expect(again.status).toBe("cancelled");
  });

  it("l'annulation supprime l'événement miroir Google", async () => {
    const s = await import("@/db/schema");
    await db.insert(s.practitionerGoogle).values({ practitionerId: "p1", syncEnabled: true });
    const calls: string[] = [];
    const withGoogle = {
      ...ports(),
      clock: fixedClock(new Date("2026-09-12T06:00:00Z")),
      googleCalendar: {
        forUser: async () => ({
          insertEvent: async () => {
            calls.push("insert");
            return { id: "evt-1" };
          },
          patchEvent: async () => void calls.push("patch"),
          deleteEvent: async () => void calls.push("delete"),
          listCalendars: async () => [],
        }),
      },
    };
    const res = await createBooking(withGoogle, {
      practitionerSlug: "alice", sessionTypeId: "st1", startAt: SLOT_A, ...patient,
    });
    await cancelBooking(withGoogle, { token: res.cancelToken, by: "patient" });
    expect(calls).toEqual(["insert", "delete"]);
  });
});

describe("rescheduleBooking", () => {
  it("déplace la réservation et libère l'ancien créneau", async () => {
    const early = { ...ports(), clock: fixedClock(new Date("2026-09-12T06:00:00Z")) };
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
    const early = { ...ports(), clock: fixedClock(new Date("2026-09-12T06:00:00Z")) };
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
    const { validateBooking } = await import("@/services/bookings");
    const { ForbiddenError } = await import("@/services/errors");
    void ForbiddenError;
    const res = await createBooking(ports(), {
      practitionerSlug: "alice", sessionTypeId: "st3", startAt: SLOT_A, ...patient,
    });
    expect(res.status).toBe("pending");
    expect(sent).toHaveLength(2); // accusé patient + demande au praticien
    expect(sent[0].subject).toContain("Demande reçue");
    expect(sent[0].to).toBe("jean@example.com");
    expect(sent[1].to).toBe("alice@example.com");
    expect(sent[1].subject).toContain("À valider");

    const out = await validateBooking(ports(), {
      bookingId: res.id, requesterUserId: "u1", accept: true,
    });
    expect(out.status).toBe("confirmed");
    expect(sent).toHaveLength(3);
    expect(sent[2].subject).toContain("Confirmation");
  });

  it("le praticien refuse avec motif : annulé + patient notifié", async () => {
    const { validateBooking } = await import("@/services/bookings");
    const res = await createBooking(ports(), {
      practitionerSlug: "alice", sessionTypeId: "st3", startAt: SLOT_A, ...patient,
    });
    await expect(
      validateBooking(ports(), { bookingId: res.id, requesterUserId: "u1", accept: false }),
    ).rejects.toBeInstanceOf(ValidationError);
    const out = await validateBooking(ports(), {
      bookingId: res.id, requesterUserId: "u1", accept: false, reason: "Complet",
    });
    expect(out.status).toBe("cancelled");
    expect(sent.at(-1)?.to).toBe("jean@example.com");
  });

  it("un tiers ne peut pas valider, ni valider deux fois", async () => {
    const { validateBooking } = await import("@/services/bookings");
    const { ConflictError, ForbiddenError } = await import("@/services/errors");
    const res = await createBooking(ports(), {
      practitionerSlug: "alice", sessionTypeId: "st3", startAt: SLOT_A, ...patient,
    });
    // Bob n'est ni le praticien ni owner.
    await expect(
      validateBooking(ports(), { bookingId: res.id, requesterUserId: "u2", accept: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await validateBooking(ports(), { bookingId: res.id, requesterUserId: "u1", accept: true });
    await expect(
      validateBooking(ports(), { bookingId: res.id, requesterUserId: "u1", accept: true }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("le owner peut valider pour un autre praticien", async () => {
    const { validateBooking } = await import("@/services/bookings");
    const res = await createBooking(ports(), {
      practitionerSlug: "bob", sessionTypeId: "st4", startAt: BOB_10H, ...patient,
    });
    const out = await validateBooking(ports(), {
      bookingId: res.id, requesterUserId: "u1", accept: true,
    });
    expect(out.status).toBe("confirmed");
  });
});

describe("variantes (déclinaisons durée/prix)", () => {
  async function addNinetyVariant() {
    const { createVariant } = await import("@/dal/session-types");
    await createVariant({
      id: "st1-v90", sessionTypeId: "st1",
      durationMin: 90, bufferAfterMin: 15, priceDisplay: "80 €", priceCents: null, sortOrder: 1,
    });
  }

  it("la grille suit la durée de la déclinaison visée", async () => {
    await addNinetyVariant();
    const base = { practitionerSlug: "alice", sessionTypeId: "st1", fromDate: "2026-09-14", days: 1 };
    const sixty = await getAvailableSlots(ports(), base);
    const ninety = await getAvailableSlots(ports(), { ...base, sessionVariantId: "st1-v90" });
    // 90 min tient dans moins de fenêtres que 60 min.
    expect(ninety.length).toBeLessThan(sixty.length);
    expect(ninety[0].endAt).toBe(
      new Date(new Date(ninety[0].startAt).getTime() + 90 * 60_000).toISOString(),
    );
    // Déclinaison inconnue → 404.
    await expect(
      getAvailableSlots(ports(), { ...base, sessionVariantId: "nope" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("la réservation fige durée, battement et variante d'origine", async () => {
    await addNinetyVariant();
    const res = await createBooking(ports(), {
      practitionerSlug: "alice", sessionTypeId: "st1", sessionVariantId: "st1-v90",
      startAt: "2026-09-14T08:00:00.000Z", ...patient,
    });
    expect(res.status).toBe("confirmed");
    expect(res.endAt).toBe("2026-09-14T09:30:00.000Z");
    const s = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(s.booking).where(eq(s.booking.id, res.id));
    expect(rows[0].sessionVariantId).toBe("st1-v90");
    expect(rows[0].durationMinSnapshot).toBe(90);
    expect(rows[0].bufferAfterMinSnapshot).toBe(15);
    expect(rows[0].sessionNameSnapshot).toBe("Séance 60min (90 min)");
    // Sans déclinaison explicite : la première variante (60 min, historique).
    const fallback = await createBooking(ports(), {
      practitionerSlug: "alice", sessionTypeId: "st1",
      startAt: "2026-09-14T10:00:00.000Z", ...patient, patientEmail: "autre@example.com",
    });
    expect(fallback.endAt).toBe("2026-09-14T11:00:00.000Z");
  });

  it("déclinaison inconnue à la réservation → 404", async () => {
    await expect(
      createBooking(ports(), {
        practitionerSlug: "alice", sessionTypeId: "st1", sessionVariantId: "nope",
        startAt: SLOT_A, ...patient,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
