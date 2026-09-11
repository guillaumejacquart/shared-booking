import { db } from "@/db/client";

import { and, eq } from "drizzle-orm";

import { member, user } from "@/db/schema";
import type { DbOrTx } from "./types";

/** Repository membres (appartenance user ↔ cabinet). */

export async function getMembership(officeId: string,
  userId: string,
  tx?: DbOrTx) {
  const conn = tx ?? db;
  const rows = await conn
    .select()
    .from(member)
    .where(and(eq(member.officeId, officeId), eq(member.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listMemberships(userId: string,
  tx?: DbOrTx) {
  const conn = tx ?? db;
  return conn.select().from(member).where(eq(member.userId, userId));
}

export async function listMembersWithUsers(officeId: string,
  tx?: DbOrTx) {
  const conn = tx ?? db;
  const members = await conn.select().from(member).where(eq(member.officeId, officeId));
  const result = [];
  for (const m of members) {
    const users = await conn.select().from(user).where(eq(user.id, m.userId)).limit(1);
    result.push({ member: m, user: users[0] ?? null });
  }
  return result;
}
