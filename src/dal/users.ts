import { getConnection } from "./connection";

import { eq } from "drizzle-orm";

import { user } from "@/db/schema";

/** Repository users (table better-auth ; le métier ne touche que la préférence de cabinet courant). */

export async function getUserEmail(userId: string): Promise<string | null> {
  const conn = getConnection();
  const rows = await conn
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return rows[0]?.email ?? null;
}

export async function getUserByEmail(email: string): Promise<{ id: string; name: string; email: string } | null> {
  const conn = getConnection();
  const rows = await conn
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  return rows[0] ?? null;
}

/** Cabinet courant sélectionné (sélecteur multi-cabinet). Null = premier cabinet. */
export async function getSelectedOfficeId(userId: string): Promise<string | null> {
  const conn = getConnection();
  const rows = await conn
    .select({ selectedOfficeId: user.selectedOfficeId })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return rows[0]?.selectedOfficeId ?? null;
}

/** Mémorise le cabinet courant (sélection validée par l'appelant). */
export async function setSelectedOfficeId(userId: string, officeId: string): Promise<void> {
  const conn = getConnection();
  await conn.update(user).set({ selectedOfficeId: officeId }).where(eq(user.id, userId));
}
