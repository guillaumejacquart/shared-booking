import { type NextRequest, NextResponse } from "next/server";

import { services } from "@/lib/container";
import { revokeInviteSchema } from "@/lib/schemas/team";
import { withAuth } from "@/app/api/_auth";

/** Annule une invitation en attente (owner). Le lien devient invalide. */
export const DELETE = withAuth(async (user, _req: NextRequest,
  { params }: { params: Promise<{ id: string; inviteId: string }> },
) => {
  const { id, inviteId } = await params;
  await services.team.revokeInvite(
    revokeInviteSchema.parse({
      officeId: id,
      inviteId,
      requesterUserId: user.id,
    }),
  );
  return NextResponse.json({ ok: true });
});
