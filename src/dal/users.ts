import { db } from "@/db/client";

import { eq } from "drizzle-orm";

import { user } from "@/db/schema";
import type { DbOrTx } from "./types";

/** Repository users (table better-auth, lecture seule depuis le métier). */

export async function getUserEmail(userId: string,
  tx?: DbOrTx): Promise<string | null> {
  const conn = tx ?? db;
  const rows = await conn
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return rows[0]?.email ?? null;
}

export async function getUserByEmail(email: string,
  tx?: DbOrTx): Promise<{ id: string; name: string; email: string } | null> {
  const conn = tx ?? db;
  const rows = await conn
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  return rows[0] ?? null;
}
