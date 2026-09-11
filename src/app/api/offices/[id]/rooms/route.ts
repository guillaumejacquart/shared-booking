import { NextRequest, NextResponse } from "next/server";

import { saveRoom } from "@/lib/services/schedule";
import { saveRoomSchema } from "@/lib/schemas/schedule";
import { toResponse } from "@/app/api/errors";
import { getAuthUser, unauthorized } from "@/app/api/_auth";

/** Crée une salle (owner). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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
      officeId: id,
      requesterUserId: user.id,
    });
    const roomId = await saveRoom({}, input);
    return NextResponse.json({ id: roomId }, { status: 201 });
  } catch (e) {
    return toResponse(e);
  }
}
