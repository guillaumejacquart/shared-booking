import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDb } from "@/test/memory-db";
import type { Db } from "@/dal/types";
import { processReminders } from "@/lib/services/reminders";
import type { OutgoingEmail } from "@/lib/email";

let db: Db;
let sent: OutgoingEmail[];

// Rappel configuré à 24h. NOW = lun. 14 sept. 2026 08:00 Paris (06:00Z).
const NOW = new Date("2026-09-14T06:00:00Z");

async function seed() {
  const s = await import("@/db/schema");
  await db.insert(s.user).values([{ id: "u1", name: "Alice", email: "alice@example.com" }]);
  await db.insert(s.office).values({
    id: "o1", name: "Cabinet", slug: "cabinet", reminderHoursBefore: 24,
  });
  await db.insert(s.room).values([{ id: "room-a", officeId: "o1", name: "Salle A" }]);
  await db.insert(s.practitioner).values([
    { id: "p1", officeId: "o1", userId: "u1", displayName: "Alice", slug: "alice" },
  ]);
  await db.insert(s.sessionType).values([
    { id: "st1", practitionerId: "p1", name: "Séance", durationMin: 60, bufferAfterMin: 0 },
  ]);
  const mk = (id: string, start: Date, status = "confirmed") =>
    db.insert(s.booking).values({
      id, officeId: "o1", practitionerId: "p1", roomId: "room-a", sessionTypeId: "st1",
      sessionNameSnapshot: "Séance", durationMinSnapshot: 60, bufferAfterMinSnapshot: 0,
      startAt: start, endAt: new Date(start.getTime() + 3_600_000),
      patientFirstName: "Jean", patientLastName: "D", patientEmail: "jean@example.com",
      status, cancelToken: `c-${id}`, rescheduleToken: `r-${id}`,
    });
  // RDV demain 07:00 Paris (dans 23h) → rappel dû.
  await mk("b1", new Date("2026-09-15T05:00:00Z"));
  // RDV dans 30h → pas encore dû.
  await mk("b2", new Date("2026-09-15T12:00:00Z"));
  // RDV passé hier → à clôturer, pas de rappel.
  await mk("b3", new Date("2026-09-13T07:00:00Z"));
}

beforeEach(async () => {
  db = createMemoryDb();
  sent = [];
  await seed();
});

describe("processReminders", () => {
  it("envoie les rappels dus une seule fois et clôture le passé", async () => {
    const first = await processReminders({
      db, now: NOW, sendEmail: async (e) => void sent.push(e),
    });
    expect(first).toEqual({ sent: 1, completed: 1 });
    expect(sent[0].to).toBe("jean@example.com");
    expect(sent[0].subject).toContain("Rappel");

    const s = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const b1 = await db.select().from(s.booking).where(eq(s.booking.id, "b1"));
    expect(b1[0].reminderSentAt).not.toBeNull();
    const b3 = await db.select().from(s.booking).where(eq(s.booking.id, "b3"));
    expect(b3[0].status).toBe("completed");

    // Second passage : rien à faire (idempotent).
    const second = await processReminders({
      db, now: NOW, sendEmail: async (e) => void sent.push(e),
    });
    expect(second).toEqual({ sent: 0, completed: 0 });
  });
});
