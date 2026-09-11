import { NextRequest, NextResponse } from "next/server";

import { updateOfficeSettings } from "@/lib/services/schedule";
import { updateOfficeSettingsSchema } from "@/lib/schemas/schedule";
import { toResponse } from "@/app/api/errors";
import { withAuth } from "@/app/api/_auth";

/** Paramètres du cabinet (owner). */
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
    const input = updateOfficeSettingsSchema.parse({
      ...(body as Record<string, unknown>),
      officeId: id,
      requesterUserId: user.id,
    });
    await updateOfficeSettings(input);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toResponse(e);
  }
});
