import { db } from "@/db/client";

import { and, eq, isNull } from "drizzle-orm";

import { invite, member, practitioner } from "@/db/schema";
import type { DbOrTx } from "./types";

/** Repository invitations équipe. */

export async function createInvite(data: {
    id: string;
    officeId: string;
    email: string;
    role: string;
    token: string;
    expiresAt: Date;
    invitedByUserId: string;
  },
  tx?: DbOrTx): Promise<string> {
  const conn = tx ?? db;
  await conn.insert(invite).values(data);
  return data.id;
}

export async function getInviteByToken(token: string,
  tx?: DbOrTx) {
  const conn = tx ?? db;
  const rows = await conn
    .select()
    .from(invite)
    .where(eq(invite.token, token))
    .limit(1);
  return rows[0] ?? null;
}

export async function listPendingInvites(officeId: string,
  tx?: DbOrTx) {
  const conn = tx ?? db;
  return conn
    .select()
    .from(invite)
    .where(and(eq(invite.officeId, officeId), isNull(invite.acceptedAt)));
}

/** Acceptation : membre + praticien créés, invitation marquée (sous mutex appelant). */
export async function acceptInvite(data: {
    inviteId: string;
    now: Date;
    member: { id: string; officeId: string; userId: string; role: string };
    practitioner: {
      id: string;
      officeId: string;
      userId: string;
      displayName: string;
      slug: string;
    };
  },
  tx?: DbOrTx) {
  const conn = tx ?? db;
  await conn.insert(member).values({ ...data.member, active: true });
  await conn.insert(practitioner).values({ ...data.practitioner, active: true });
  await conn
    .update(invite)
    .set({ acceptedAt: data.now })
    .where(eq(invite.id, data.inviteId));
}
