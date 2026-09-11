import { NextRequest, NextResponse } from "next/server";

import { updateProfile } from "@/lib/services/schedule";
import { updateProfileSchema } from "@/lib/schemas/schedule";
import { toResponse } from "@/app/api/errors";
import { withAuth } from "@/app/api/_auth";

/** Met à jour le profil public d'un praticien (lui-même ou owner). */
export const PATCH = withAuth(async (user, req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }
  try {
    const input = updateProfileSchema.parse({
      ...(body as Record<string, unknown>),
      practitionerId: id,
      requesterUserId: user.id,
    });
    await updateProfile(input);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toResponse(e);
  }
});
