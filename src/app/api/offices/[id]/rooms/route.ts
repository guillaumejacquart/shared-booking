import { NextRequest, NextResponse } from "next/server";

import { saveRoom } from "@/lib/services/schedule";
import { saveRoomSchema } from "@/lib/schemas/schedule";
import { readJsonBody } from "@/app/api/errors";
import { withAuth } from "@/app/api/_auth";

/** Crée une salle (owner). */
export const POST = withAuth(async (user, req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const body = await readJsonBody(req);
  const input = saveRoomSchema.parse({
    ...body,
    officeId: id,
    requesterUserId: user.id,
  });
  const roomId = await saveRoom(input);
  return NextResponse.json({ id: roomId }, { status: 201 });
});
