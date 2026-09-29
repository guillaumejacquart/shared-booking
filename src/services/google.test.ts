import { beforeEach, describe, expect, it } from "vitest";

import { setConnection } from "@/dal/connection";
import * as googleAccountsDal from "@/dal/google-accounts";
import * as practitionerGoogleDal from "@/dal/practitioner-google";
import type { Db } from "@/dal/types";
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
    const status = await getGoogleStatus("u1");
    expect(status.connected).toBe(false);
    expect(status.prefs).toBeNull();
  });

  it("activer le push sans serveur configuré → erreur explicite", async () => {
    await seedGoogleAccount();
    await expect(
      saveGooglePrefs({ requesterUserId: "u1", syncEnabled: true }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("préférences locales persistées (push coupé)", async () => {
    const status = await saveGooglePrefs({
      requesterUserId: "u1",
      syncEnabled: false,
      calendarId: "primary",
      showPatientName: true,
    });
    expect(status.prefs?.syncEnabled).toBe(false);
    expect(status.prefs?.showPatientName).toBe(true);
    const prefs = await practitionerGoogleDal.getGooglePrefs("p1");
    expect(prefs?.calendarId).toBe("primary");
  });

  it("déconnexion : compte supprimé + push coupé", async () => {
    await seedGoogleAccount();
    await practitionerGoogleDal.saveGooglePrefs("p1", { syncEnabled: false });
    await disconnectGoogle("u1");
    expect(await googleAccountsDal.hasGoogleAccount("u1")).toBe(false);
    const status = await getGoogleStatus("u1");
    expect(status.connected).toBe(false);
    expect(status.prefs?.syncEnabled).toBe(false);
  });
});
