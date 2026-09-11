import { eq } from "drizzle-orm";

import { user } from "@/db/schema";
import type { DbOrTx } from "./types";

/** Repository users (table better-auth, lecture seule depuis le métier). */

export async function getUserEmail(
  db: DbOrTx,
  userId: string,
): Promise<string | null> {
  const rows = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return rows[0]?.email ?? null;
}

export async function getUserByEmail(
  db: DbOrTx,
  email: string,
): Promise<{ id: string; name: string; email: string } | null> {
  const rows = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  return rows[0] ?? null;
}
