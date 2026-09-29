import { getConnection } from "./connection";

import { and, eq } from "drizzle-orm";

import { account } from "@/db/schema";

/** Tokens OAuth Google d'un utilisateur (ligne `account` provider `google`). */

export interface GoogleTokens {
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpiresAt: Date | null;
}

export async function getGoogleTokens(
  userId: string,
): Promise<GoogleTokens | null> {
  const conn = getConnection();
  const rows = await conn
    .select({
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      accessTokenExpiresAt: account.accessTokenExpiresAt,
    })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "google")))
    .limit(1);
  return rows[0] ?? null;
}

export async function hasGoogleAccount(userId: string): Promise<boolean> {
  return (await getGoogleTokens(userId)) !== null;
}

export async function deleteGoogleAccount(userId: string): Promise<void> {
  const conn = getConnection();
  await conn
    .delete(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "google")));
}
