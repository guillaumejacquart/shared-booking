import { NextRequest, NextResponse } from "next/server";

import { deleteRoom, saveRoom } from "@/lib/services/schedule";
import { deleteRoomSchema, saveRoomSchema } from "@/lib/schemas/schedule";
import { toResponse } from "@/app/api/errors";
import { getAuthUser, unauthorized } from "@/app/api/_auth";

/** Modifie une salle (owner). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; roomId: string }> },
) {
  const { id, roomId } = await params;
  const user = await getAuthUser();
  if (!user) return unauthorized();
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
    await saveRoom({}, input);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toResponse(e);
  }
}

/** Supprime une salle (owner, garde anti-réservations). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; roomId: string }> },
) {
  const { id, roomId } = await params;
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    const input = deleteRoomSchema.parse({
      officeId: id,
      requesterUserId: user.id,
      id: roomId,
    });
    await deleteRoom({}, input);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toResponse(e);
  }
}
