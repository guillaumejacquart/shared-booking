import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDb } from "@/test/memory-db";
import { setConnection } from "@/dal/connection";
import type { Db } from "@/dal/types";
import {
  getUserPreferences,
  saveUserPreferences,
} from "@/lib/services/preferences";

let db: Db;

beforeEach(async () => {
  db = createMemoryDb();
  setConnection(db);
  const s = await import("@/db/schema");
  await db.insert(s.user).values([{ id: "u1", name: "Alice", email: "alice@example.com" }]);
});

describe("saveUserPreferences", () => {
  it("crée puis met à jour les préférences (upsert)", async () => {
    expect(await getUserPreferences("u1")).toBeNull();
    await saveUserPreferences({ requesterUserId: "u1", palette: "lavande", mode: "dark" });
    expect(await getUserPreferences("u1")).toMatchObject({ palette: "lavande", mode: "dark" });
    await saveUserPreferences({ requesterUserId: "u1", palette: "sable", mode: "light" });
    expect(await getUserPreferences("u1")).toMatchObject({ palette: "sable", mode: "light" });
  });

  it("refuse palette et mode inconnus", async () => {
    const { savePreferencesSchema } = await import("@/lib/services/preferences");
    expect(
      savePreferencesSchema.safeParse({ requesterUserId: "u1", palette: "zinc", mode: "dark" }).success,
    ).toBe(false);
    expect(
      savePreferencesSchema.safeParse({ requesterUserId: "u1", palette: "sauge", mode: "sombre" }).success,
    ).toBe(false);
  });
});
