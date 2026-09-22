import { getConnection } from "./connection";

import { eq } from "drizzle-orm";

import { userPreferences } from "@/db/schema";
import type { UserPreferences } from "./types";

/** Préférences d'apparence personnelles (thème dashboard). */

export async function getPreferences(
  userId: string,
): Promise<UserPreferences | null> {
  const conn = getConnection();
  const rows = await conn
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function savePreferences(
  userId: string,
  data: { palette: string; mode: string },
): Promise<void> {
  const conn = getConnection();
  await conn
    .insert(userPreferences)
    .values({ userId, ...data })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { ...data, updatedAt: new Date() },
    });
}
