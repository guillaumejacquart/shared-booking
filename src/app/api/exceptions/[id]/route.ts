import { NextRequest, NextResponse } from "next/server";

import { deleteException } from "@/lib/services/schedule";
import { deleteExceptionSchema } from "@/lib/schemas/schedule";
import { toResponse } from "@/app/api/errors";
import { getAuthUser, unauthorized } from "@/app/api/_auth";

/** Supprime une exception (?practitionerId=). */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const practitionerId = new URL(req.url).searchParams.get("practitionerId");
  if (!practitionerId) {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }
  try {
    const input = deleteExceptionSchema.parse({
      id,
      practitionerId,
      requesterUserId: user.id,
    });
    await deleteException({}, input);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toResponse(e);
  }
}
