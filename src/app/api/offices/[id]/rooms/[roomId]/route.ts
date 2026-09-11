import { NextRequest, NextResponse } from "next/server";

import { deleteRoom, saveRoom } from "@/lib/services/schedule";
import { deleteRoomSchema, saveRoomSchema } from "@/lib/schemas/schedule";
import { toResponse } from "@/app/api/errors";
import { withAuth } from "@/app/api/_auth";

/** Modifie une salle (owner). */
export const PATCH = withAuth(async (user, req: NextRequest,
  { params }: { params: Promise<{ id: string; roomId: string }> },
) => {
  const { id, roomId } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }
  try {
    const input = saveRoomSchema.parse({
      ...(body as Record<string, unknown>),
      id: roomId,
      officeId: id,
      requesterUserId: user.id,
    });
    await saveRoom(input);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toResponse(e);
  }
});

/** Supprime une salle (owner, garde anti-réservations). */
export const DELETE = withAuth(async (user, _req: NextRequest,
  { params }: { params: Promise<{ id: string; roomId: string }> },
) => {
  const { id, roomId } = await params;
  try {
    const input = deleteRoomSchema.parse({
      officeId: id,
      requesterUserId: user.id,
      id: roomId,
    });
    await deleteRoom(input);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toResponse(e);
  }
});
