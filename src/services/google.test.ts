import { beforeEach, describe, expect, it, vi } from "vitest";

import { setConnection } from "@/dal/connection";
import * as googleAccountsDal from "@/dal/google-accounts";
import * as practitionerGoogleDal from "@/dal/practitioner-google";
import type { Db } from "@/dal/types";
import { GoogleCalendarError } from "@/lib/google-calendar";
import { testPorts } from "@/test/ports";
import { createMemoryDb } from "@/test/memory-db";
import { ValidationError } from "@/services/errors";
import {
  disconnectGoogle,
  getGoogleStatus,
  saveGooglePrefs,
} from "@/services/google";

let db: Db;

async function seed() {
  const s = await import("@/db/schema");
  await db.insert(s.user).values({ id: "u1", name: "Camille", email: "camille@example.com" });
  await db.insert(s.office).values({ id: "o1", name: "Cabinet", slug: "cabinet" });
  await db.insert(s.practitioner).values({
    id: "p1",
    officeId: "o1",
    userId: "u1",
    displayName: "Camille",
    slug: "camille",
  });
}

async function seedGoogleAccount() {
  const s = await import("@/db/schema");
  await db.insert(s.account).values({
    id: "a1",
    accountId: "google-123",
    providerId: "google",
    userId: "u1",
    refreshToken: "rt",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe("google service", () => {
  beforeEach(async () => {
    db = createMemoryDb();
    setConnection(db);
    await seed();
  });

  it("statut initial : déconnecté, sans préférences", async () => {
    const status = await getGoogleStatus(testPorts(), "u1");
    expect(status.connected).toBe(false);
    expect(status.tokenValid).toBeNull();
    expect(status.prefs).toBeNull();
    expect(status.sync).toEqual({ ok: 0, pending: 0, error: 0 });
    expect(status.recentErrors).toEqual([]);
  });

  it("activer le push sans serveur configuré → erreur explicite", async () => {
    await seedGoogleAccount();
    await expect(
      saveGooglePrefs(testPorts(), { requesterUserId: "u1", syncEnabled: true }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("préférences locales persistées (push coupé)", async () => {
    const result = await saveGooglePrefs(testPorts(), {
      requesterUserId: "u1",
      syncEnabled: false,
      calendarId: "primary",
      showPatientName: true,
    });
    expect(result.status.prefs?.syncEnabled).toBe(false);
    expect(result.status.prefs?.showPatientName).toBe(true);
    expect(result.migration).toBeNull();
    const prefs = await practitionerGoogleDal.getGooglePrefs("p1");
    expect(prefs?.calendarId).toBe("primary");
  });

  it("déconnexion : compte supprimé + push coupé", async () => {
    await seedGoogleAccount();
    await practitionerGoogleDal.saveGooglePrefs("p1", { syncEnabled: false });
    await disconnectGoogle("u1");
    expect(await googleAccountsDal.hasGoogleAccount("u1")).toBe(false);
    const status = await getGoogleStatus(testPorts(), "u1");
    expect(status.connected).toBe(false);
    expect(status.prefs?.syncEnabled).toBe(false);
  });

  it("statut live : jeton vérifié + compteurs + erreurs récentes", async () => {
    const s = await import("@/db/schema");
    await seedGoogleAccount();
    await practitionerGoogleDal.saveGooglePrefs("p1", { syncEnabled: true });
    await db.insert(s.office).values({ id: "o9", name: "Cabinet", slug: "cabinet-9" });
    await db.insert(s.room).values({ id: "room-9", officeId: "o9", name: "Salle", color: "#000" });
    await db.insert(s.booking).values({
      id: "b-err",
      officeId: "o9",
      practitionerId: "p1",
      roomId: "room-9",
      sessionNameSnapshot: "Séance",
      durationMinSnapshot: 60,
      bufferAfterMinSnapshot: 0,
      startAt: new Date("2026-11-01T09:00:00.000Z"),
      endAt: new Date("2026-11-01T10:00:00.000Z"),
      patientFirstName: "Jean",
      patientLastName: "Dupont",
      patientEmail: "jean@example.com",
      status: "confirmed",
      cancelToken: "ct-err",
      rescheduleToken: "rt-err",
      googleSyncStatus: "error",
      googleSyncError: "HTTP 403",
    });
    const ports = testPorts({
      googleCalendar: {
        forUser: async () => ({
          insertEvent: async () => ({ id: "evt-x" }),
          patchEvent: async () => {},
          deleteEvent: async () => {},
          listCalendars: async () => [],
        }),
      },
    });
    const status = await getGoogleStatus(ports, "u1");
    expect(status.connected).toBe(true);
    expect(status.tokenValid).toBe(true);
    expect(status.sync).toEqual({ ok: 0, pending: 0, error: 1 });
    expect(status.recentErrors).toHaveLength(1);
    expect(status.recentErrors[0]?.bookingId).toBe("b-err");
  });

  it("changement d'agenda → miroirs déplacés (delete ancien + insert nouveau)", async () => {
    // `isGoogleConfigured` se fige à l'import : modules frais + env stubbé.
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-client-secret");
    vi.resetModules();
    try {
      const connMod = await import("@/dal/connection");
      connMod.setConnection(db);
      const schema = await import("@/db/schema");
      const prefsDal = await import("@/dal/practitioner-google");
      const googleSvc = await import("@/services/google");
      await db.insert(schema.account).values({
        id: "a1",
        accountId: "google-123",
        providerId: "google",
        userId: "u1",
        refreshToken: "rt",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await prefsDal.saveGooglePrefs("p1", { syncEnabled: true, calendarId: "old-cal" });
      await db.insert(schema.office).values({ id: "o9", name: "Cabinet", slug: "cabinet-9" });
      await db.insert(schema.room).values({ id: "room-9", officeId: "o9", name: "Salle", color: "#000" });
      await db.insert(schema.booking).values({
        id: "b-move",
        officeId: "o9",
        practitionerId: "p1",
        roomId: "room-9",
        sessionNameSnapshot: "Séance",
        durationMinSnapshot: 60,
        bufferAfterMinSnapshot: 0,
        startAt: new Date("2026-12-01T09:00:00.000Z"),
        endAt: new Date("2026-12-01T10:00:00.000Z"),
        patientFirstName: "Jean",
        patientLastName: "Dupont",
        patientEmail: "jean@example.com",
        status: "confirmed",
        cancelToken: "ct-move",
        rescheduleToken: "rt-move",
        googleEventId: "evt-old",
        googleSyncStatus: "ok",
      });
      const calls: { kind: string; calendarId: string }[] = [];
      const ports = testPorts({
        clock: { now: () => new Date("2026-11-01T00:00:00.000Z") },
        googleCalendar: {
          forUser: async () => ({
            insertEvent: async (calendarId: string) => {
              calls.push({ kind: "insert", calendarId });
              return { id: "evt-new" };
            },
            patchEvent: async () => {},
            deleteEvent: async (calendarId: string) => {
              calls.push({ kind: "delete", calendarId });
            },
            listCalendars: async () => [],
          }),
        },
      });
      const result = await googleSvc.saveGooglePrefs(ports, {
        requesterUserId: "u1",
        syncEnabled: true,
        calendarId: "new-cal",
        showPatientName: false,
      });
      expect(calls).toContainEqual({ kind: "delete", calendarId: "old-cal" });
      expect(calls).toContainEqual({ kind: "insert", calendarId: "new-cal" });
      expect(result.migration).toEqual({ moved: 1, failed: 0, cleaned: 0 });
      expect(result.status.prefs?.calendarId).toBe("new-cal");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("push coupé → aucune migration même si l'agenda change", async () => {
    await practitionerGoogleDal.saveGooglePrefs("p1", { syncEnabled: true, calendarId: "old-cal" });
    const result = await saveGooglePrefs(testPorts(), {
      requesterUserId: "u1",
      syncEnabled: false,
      calendarId: "new-cal",
      showPatientName: false,
    });
    expect(result.migration).toBeNull();
    expect(result.status.prefs?.syncEnabled).toBe(false);
  });

  it("jeton rejeté par Google → tokenValid false (reconnecter)", async () => {
    await seedGoogleAccount();
    const ports = testPorts({
      googleCalendar: {
        forUser: async () => {
          throw new GoogleCalendarError("auth", "refresh rejeté");
        },
      },
    });
    const status = await getGoogleStatus(ports, "u1");
    expect(status.connected).toBe(true);
    expect(status.tokenValid).toBe(false);
  });
});
