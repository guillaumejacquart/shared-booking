import { NextRequest, NextResponse } from "next/server";

import { removeMember } from "@/lib/services/team";
import { removeMemberSchema } from "@/lib/schemas/team";
import { withAuth } from "@/app/api/_auth";

/** Retire un membre du cabinet (owner). Désactivation, historique conservé. */
export const DELETE = withAuth(async (user, _req: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) => {
  const { id, memberId } = await params;
  await removeMember(
    removeMemberSchema.parse({
      officeId: id,
      memberId,
      requesterUserId: user.id,
    }),
  );
  return NextResponse.json({ ok: true });
});
