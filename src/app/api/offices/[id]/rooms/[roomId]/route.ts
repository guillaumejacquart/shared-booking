import { NextRequest, NextResponse } from "next/server";

import { deleteRoom, saveRoom } from "@/lib/services/schedule";
import { deleteRoomSchema, saveRoomSchema } from "@/lib/schemas/schedule";
import { readJsonBody } from "@/app/api/errors";
import { withAuth } from "@/app/api/_auth";

/** Modifie une salle (owner). */
export const PATCH = withAuth(async (user, req: NextRequest,
  { params }: { params: Promise<{ id: string; roomId: string }> },
) => {
  const { id, roomId } = await params;
  const body = await readJsonBody(req);
  const input = saveRoomSchema.parse({
    ...body,
    id: roomId,
    officeId: id,
    requesterUserId: user.id,
  });
  await saveRoom(input);
  return NextResponse.json({ ok: true });
});

/** Supprime une salle (owner, garde anti-réservations). */
export const DELETE = withAuth(async (user, _req: NextRequest,
  { params }: { params: Promise<{ id: string; roomId: string }> },
) => {
  const { id, roomId } = await params;
  const input = deleteRoomSchema.parse({
    officeId: id,
    requesterUserId: user.id,
    id: roomId,
  });
  await deleteRoom(input);
  return NextResponse.json({ ok: true });
});
