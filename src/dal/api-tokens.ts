import { getConnection } from "./connection";

import { and, asc, eq, sql } from "drizzle-orm";

import { apiToken } from "@/db/schema";
import type { ApiToken, DbOrTx } from "./types";

/**
 * Repository des clés d'API personnelles (PAT).
 * Stocke uniquement le hash SHA-256 du secret : le clair n'existe qu'au
 * moment de la création (rendu une fois au praticien, jamais relisible).
 */

export interface NewApiToken {
  practitionerId: string;
  name: string;
  tokenHash: string;
  tokenPrefix: string;
  scopes: string[];
  createdByUserId: string;
  expiresAt: Date | null;
}

export async function insertApiToken(
  data: NewApiToken,
  conn: DbOrTx = getConnection(),
): Promise<ApiToken> {
  const rows = await conn
    .insert(apiToken)
    .values({
      practitionerId: data.practitionerId,
      name: data.name,
      tokenHash: data.tokenHash,
      tokenPrefix: data.tokenPrefix,
      scopes: JSON.stringify(data.scopes),
      createdByUserId: data.createdByUserId,
      expiresAt: data.expiresAt,
    })
    .returning();
  return rows[0];
}

/** Clés d'un praticien (métadonnées seules, les plus récentes d'abord). */
export async function listApiTokensByPractitioner(
  practitionerId: string,
): Promise<ApiToken[]> {
  const conn = getConnection();
  return conn
    .select()
    .from(apiToken)
    .where(eq(apiToken.practitionerId, practitionerId))
    .orderBy(asc(apiToken.createdAt));
}

/** Résolution d'un secret présenté : recherche par hash (unique). */
export async function findApiTokenByHash(tokenHash: string): Promise<ApiToken | null> {
  const conn = getConnection();
  const rows = await conn
    .select()
    .from(apiToken)
    .where(eq(apiToken.tokenHash, tokenHash))
    .limit(1);
  return rows[0] ?? null;
}

/** Usage constaté (best-effort, n'échoue jamais la requête appelante). */
export async function touchApiTokenLastUsed(tokenId: string, now: Date): Promise<void> {
  const conn = getConnection();
  await conn
    .update(apiToken)
    .set({ lastUsedAt: now, updatedAt: sql`(unixepoch())` })
    .where(eq(apiToken.id, tokenId));
}

/** Révocation (idempotente) : réservée au praticien propriétaire. */
export async function revokeApiToken(
  tokenId: string,
  practitionerId: string,
  now: Date,
): Promise<boolean> {
  const conn = getConnection();
  const rows = await conn
    .update(apiToken)
    .set({ revokedAt: now, updatedAt: sql`(unixepoch())` })
    .where(and(eq(apiToken.id, tokenId), eq(apiToken.practitionerId, practitionerId)))
    .returning({ id: apiToken.id });
  return rows.length > 0;
}
