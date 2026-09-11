import { NextRequest, NextResponse } from "next/server";

import { deleteException } from "@/lib/services/schedule";
import { deleteExceptionSchema } from "@/lib/schemas/schedule";
import { toResponse } from "@/app/api/errors";
import { withAuth } from "@/app/api/_auth";

/** Supprime une exception (?practitionerId=). */
export const DELETE = withAuth(async (user, req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
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
});
