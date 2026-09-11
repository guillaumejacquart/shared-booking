import { getConnection } from "./connection";

import { eq } from "drizzle-orm";

import { user } from "@/db/schema";

/** Repository users (table better-auth, lecture seule depuis le métier). */

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
