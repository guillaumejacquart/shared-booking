import { NextRequest, NextResponse } from "next/server";

import { updateOfficeSettings } from "@/lib/services/schedule";
import { updateOfficeSettingsSchema } from "@/lib/schemas/schedule";
import { readJsonBody } from "@/app/api/errors";
import { withAuth } from "@/app/api/_auth";

/** Paramètres du cabinet (owner). */
export const PATCH = withAuth(async (user, req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const body = await readJsonBody(req);
  const input = updateOfficeSettingsSchema.parse({
    ...body,
    officeId: id,
    requesterUserId: user.id,
  });
  await updateOfficeSettings(input);
  return NextResponse.json({ ok: true });
});
