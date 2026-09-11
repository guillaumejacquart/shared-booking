import { and, eq, isNull } from "drizzle-orm";

import { invite, member, practitioner } from "@/db/schema";
import type { DbOrTx } from "./types";

/** Repository invitations équipe. */

export async function createInvite(
  db: DbOrTx,
  data: {
    id: string;
    officeId: string;
    email: string;
    role: string;
    token: string;
    expiresAt: Date;
    invitedByUserId: string;
  },
): Promise<string> {
  await db.insert(invite).values(data);
  return data.id;
}

export async function getInviteByToken(db: DbOrTx, token: string) {
  const rows = await db
    .select()
    .from(invite)
    .where(eq(invite.token, token))
    .limit(1);
  return rows[0] ?? null;
}

export async function listPendingInvites(db: DbOrTx, officeId: string) {
  return db
    .select()
    .from(invite)
    .where(and(eq(invite.officeId, officeId), isNull(invite.acceptedAt)));
}

/** Acceptation : membre + praticien créés, invitation marquée (sous mutex appelant). */
export async function acceptInvite(
  db: DbOrTx,
  data: {
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
) {
  await db.insert(member).values({ ...data.member, active: true });
  await db.insert(practitioner).values({ ...data.practitioner, active: true });
  await db
    .update(invite)
    .set({ acceptedAt: data.now })
    .where(eq(invite.id, data.inviteId));
}
