import { type NextRequest, NextResponse } from "next/server";

import { services } from "@/lib/container";
import { changeMemberRoleSchema, removeMemberSchema } from "@/lib/schemas/team";
import { withAuth } from "@/app/api/_auth";

/** Change le rôle d'un membre du cabinet (owner). */
export const PATCH = withAuth(async (user, req: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) => {
  const { id, memberId } = await params;
  const body = await req.json().catch(() => null);
  await services.team.changeMemberRole(
    changeMemberRoleSchema.parse({
      officeId: id,
      memberId,
      requesterUserId: user.id,
      role: body?.role,
    }),
  );
  return NextResponse.json({ ok: true });
});

/** Retire un membre du cabinet (owner). Désactivation, historique conservé. */
export const DELETE = withAuth(async (user, _req: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) => {
  const { id, memberId } = await params;
  await services.team.removeMember(
    removeMemberSchema.parse({
      officeId: id,
      memberId,
      requesterUserId: user.id,
    }),
  );
  return NextResponse.json({ ok: true });
});
