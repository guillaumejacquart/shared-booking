import { getConnection } from "./connection";

import { and, eq } from "drizzle-orm";

import { member, user } from "@/db/schema";

/** Repository membres (appartenance user ↔ cabinet). */

export async function getMembership(officeId: string,
  userId: string) {
  const conn = getConnection();
  const rows = await conn
    .select()
    .from(member)
    .where(and(eq(member.officeId, officeId), eq(member.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listMemberships(userId: string) {
  const conn = getConnection();
  return conn.select().from(member).where(eq(member.userId, userId));
}

export async function listMembersWithUsers(officeId: string) {
  const conn = getConnection();
  const members = await conn.select().from(member).where(eq(member.officeId, officeId));
  const result = [];
  for (const m of members) {
    const users = await conn.select().from(user).where(eq(user.id, m.userId)).limit(1);
    result.push({ member: m, user: users[0] ?? null });
  }
  return result;
}
