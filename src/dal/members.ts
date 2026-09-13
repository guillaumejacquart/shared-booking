import { getConnection } from "./connection";

import { and, eq } from "drizzle-orm";

import { member, practitioner, roomMember, user } from "@/db/schema";

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

export async function getMembershipById(memberId: string) {
  const conn = getConnection();
  const rows = await conn
    .select()
    .from(member)
    .where(eq(member.id, memberId))
    .limit(1);
  return rows[0] ?? null;
}

export async function listMemberships(userId: string) {
  const conn = getConnection();
  return conn.select().from(member).where(eq(member.userId, userId));
}

/** Membres actifs d'un cabinet (les retirés ne sont plus listés). */
export async function listMembersWithUsers(officeId: string) {
  const conn = getConnection();
  const members = await conn
    .select()
    .from(member)
    .where(and(eq(member.officeId, officeId), eq(member.active, true)));
  const result = [];
  for (const m of members) {
    const users = await conn.select().from(user).where(eq(user.id, m.userId)).limit(1);
    result.push({ member: m, user: users[0] ?? null });
  }
  return result;
}

/**
 * Retire un membre : l'appartenance et le praticien sont désactivés (SPEC.md
 * §F2 « deactivate, not delete »). Réservations et historique conservés.
 */
export async function deactivateMember(memberId: string): Promise<void> {
  const conn = getConnection();
  const rows = await conn
    .select()
    .from(member)
    .where(eq(member.id, memberId))
    .limit(1);
  const m = rows[0];
  if (!m) return;
  await conn.update(member).set({ active: false }).where(eq(member.id, memberId));

  const pracRows = await conn
    .select()
    .from(practitioner)
    .where(
      and(eq(practitioner.userId, m.userId), eq(practitioner.officeId, m.officeId)),
    )
    .limit(1);
  const p = pracRows[0];
  if (!p) return;
  await conn.update(practitioner).set({ active: false }).where(eq(practitioner.id, p.id));
  // Quitte les allowlists de salles : sinon l'éditeur de salles renvoie un id
  // inactif et la sauvegarde est refusée.
  await conn.delete(roomMember).where(eq(roomMember.practitionerId, p.id));
}
