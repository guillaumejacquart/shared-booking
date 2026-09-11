import { and, eq } from "drizzle-orm";

import { member, user } from "@/db/schema";
import type { DbOrTx } from "./types";

/** Repository membres (appartenance user ↔ cabinet). */

export async function getMembership(
  db: DbOrTx,
  officeId: string,
  userId: string,
) {
  const rows = await db
    .select()
    .from(member)
    .where(and(eq(member.officeId, officeId), eq(member.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listMemberships(db: DbOrTx, userId: string) {
  return db.select().from(member).where(eq(member.userId, userId));
}

export async function listMembersWithUsers(db: DbOrTx, officeId: string) {
  const members = await db.select().from(member).where(eq(member.officeId, officeId));
  const result = [];
  for (const m of members) {
    const users = await db.select().from(user).where(eq(user.id, m.userId)).limit(1);
    result.push({ member: m, user: users[0] ?? null });
  }
  return result;
}
