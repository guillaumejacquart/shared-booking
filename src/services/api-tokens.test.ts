import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDb } from "@/test/memory-db";
import { setConnection } from "@/dal/connection";
import type { Db } from "@/dal/types";
import { fixedClock } from "@/lib/ports";
import type { Ports } from "@/lib/ports";
import { testPorts } from "@/test/ports";
import { seedSingleVariant } from "@/test/session-types";
import { API_TOKEN_PREFIX } from "@/lib/schemas/api-tokens";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/services/errors";
import {
  cancelApiBooking,
  createApiBooking,
  getApiCatalog,
  listApiBookings,
} from "@/services/bookings/api";
import {
  createApiToken,
  hasApiScope,
  hashApiToken,
  listApiTokens,
  resolveApiToken,
  revokeApiToken,
} from "@/services/api-tokens";

const NOW = new Date("2026-09-14T06:00:00Z");
const START = "2026-09-14T12:00:00.000Z";

let db: Db;

function ports(): Ports {
  return testPorts({ clock: fixedClock(NOW), sendEmail: async () => {} });
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
  });
  await db.insert(schema.room).values([
    { id: "room-a", officeId: "o1", name: "Salle A", color: "#3b82f6" },
    { id: "room-b", officeId: "o1", name: "Salle B", color: "#22c55e" },
  ]);
  await db.insert(schema.practitioner).values([
    { id: "p1", officeId: "o1", userId: "u1", displayName: "Alice", slug: "alice" },
    { id: "p2", officeId: "o1", userId: "u2", displayName: "Bob", slug: "bob" },
  ]);
  await seedSingleVariant(db, {
    id: "st1",
    practitionerId: "p1",
    name: "Séance 60min",
    durationMin: 60,
  });
}

const patient = {
  patientFirstName: "Jean",
  patientLastName: "Dupont",
  patientEmail: "jean@example.com",
};

function apiInput(overrides: Record<string, unknown> = {}) {
  return {
    practitionerId: "p1",
    sessionTypeId: "st1",
    startAt: START,
    overrideOff: false,
    ...patient,
    ...overrides,
  };
}

describe("api tokens service", () => {
  beforeEach(async () => {
    db = createMemoryDb();
    setConnection(db);
    await seed();
  });

  it("création : secret unique affiché une fois, seul le hash persiste", async () => {
    const created = await createApiToken(ports(), {
      requesterUserId: "u1",
      name: "Calendly",
      write: true,
    });
    expect(created.token.startsWith(API_TOKEN_PREFIX)).toBe(true);
    expect(created.scopes).toEqual(["read", "write"]);

    const schema = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(schema.apiToken)
      .where(eq(schema.apiToken.id, created.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashApiToken(created.token));
    expect(rows[0].tokenHash).not.toContain(created.token.slice(API_TOKEN_PREFIX.length));
  });

  it("résolution : secret valide → praticien, inconnu → null", async () => {
    const created = await createApiToken(ports(), {
      requesterUserId: "u1",
      name: "Test",
      write: false,
    });
    const resolved = await resolveApiToken(ports(), created.token);
    expect(resolved?.practitioner.id).toBe("p1");
    expect(resolved?.scopes).toEqual(["read"]);

    expect(await resolveApiToken(ports(), "nonsense")).toBeNull();
    expect(await resolveApiToken(ports(), `${API_TOKEN_PREFIX}inconnu0000000000`)).toBeNull();
  });

  it("scopes : write implique read, read seule n'écrit pas", () => {
    expect(hasApiScope(["read", "write"], "read")).toBe(true);
    expect(hasApiScope(["read", "write"], "write")).toBe(true);
    expect(hasApiScope(["read"], "read")).toBe(true);
    expect(hasApiScope(["read"], "write")).toBe(false);
  });

  it("révocation : le secret ne résout plus, liste sans secret", async () => {
    const created = await createApiToken(ports(), {
      requesterUserId: "u1",
      name: "Temporaire",
      write: true,
    });
    await revokeApiToken(ports(), { requesterUserId: "u1", tokenId: created.id });
    expect(await resolveApiToken(ports(), created.token)).toBeNull();

    const listed = await listApiTokens(ports(), "u1");
    expect(listed).toHaveLength(1);
    expect(listed[0].revokedAt).not.toBeNull();
    expect(listed[0]).not.toHaveProperty("token");
    expect(listed[0]).not.toHaveProperty("tokenHash");
  });

  it("révocation d'autrui : introuvable", async () => {
    const created = await createApiToken(ports(), {
      requesterUserId: "u1",
      name: "Alice",
      write: true,
    });
    await expect(
      revokeApiToken(ports(), { requesterUserId: "u2", tokenId: created.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("expiration passée refusée à la création, expirée invisible à la résolution", async () => {
    await expect(
      createApiToken(ports(), {
        requesterUserId: "u1",
        name: "Périmée",
        write: true,
        expiresAt: new Date(NOW.getTime() - 1000).toISOString(),
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const schema = await import("@/db/schema");
    const created = await createApiToken(ports(), {
      requesterUserId: "u1",
      name: "Bientôt périmée",
      write: true,
      expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
    });
    const { eq } = await import("drizzle-orm");
    await db
      .update(schema.apiToken)
      .set({ expiresAt: new Date(NOW.getTime() - 1000) })
      .where(eq(schema.apiToken.id, created.id));
    expect(await resolveApiToken(ports(), created.token)).toBeNull();
  });
});

describe("api bookings (v1)", () => {
  beforeEach(async () => {
    db = createMemoryDb();
    setConnection(db);
    await seed();
  });

  it("création avec salle auto-assignée, origine api", async () => {
    const created = await createApiBooking(ports(), apiInput());
    expect(created.status).toBe("confirmed");

    const schema = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(schema.booking)
      .where(eq(schema.booking.id, created.id));
    expect(rows[0].origin).toBe("api");
    expect(rows[0].roomId).toBe("room-a");
  });

  it("double réservation du même créneau : conflit", async () => {
    await createApiBooking(ports(), apiInput());
    // Le praticien est occupé : la seconde tentative échoue même avec
    // auto-assignation (aucune salle ne sauve un chevauchement praticien).
    await expect(
      createApiBooking(ports(), apiInput()),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("annulation d'autrui : interdite", async () => {
    const created = await createApiBooking(ports(), apiInput());
    await expect(
      cancelApiBooking(ports(), { practitionerId: "p2", bookingId: created.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("catalogue : séances actives et salles du praticien", async () => {
    const catalog = await getApiCatalog("p1");
    expect(catalog.practitioner.slug).toBe("alice");
    expect(catalog.sessionTypes).toHaveLength(1);
    expect(catalog.sessionTypes[0].variants[0].durationMin).toBe(60);
    expect(catalog.rooms.map((room) => room.id)).toEqual(["room-a", "room-b"]);
  });

  it("liste : sans les tokens magiques patient", async () => {
    const created = await createApiBooking(ports(), apiInput());
    const listed = await listApiBookings("p1", {
      start: NOW,
      end: new Date(NOW.getTime() + 30 * 86_400_000),
    });
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(created.id);
    expect(listed[0].patient.email).toBe("jean@example.com");
    expect(listed[0]).not.toHaveProperty("cancelToken");
    expect(listed[0]).not.toHaveProperty("rescheduleToken");
  });
});
