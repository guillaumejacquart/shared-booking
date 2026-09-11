import { NextRequest, NextResponse } from "next/server";

import { replaceAvailability } from "@/lib/services/schedule";
import { replaceAvailabilitySchema } from "@/lib/schemas/schedule";
import { toResponse } from "@/app/api/errors";
import { withAuth } from "@/app/api/_auth";

/** Remplace les disponibilités hebdo d'un praticien (lui-même ou owner). */
export const PUT = withAuth(async (user, req: NextRequest) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }
  const practitionerId = (body as { practitionerId?: unknown })?.practitionerId;
  if (typeof practitionerId !== "string" || !practitionerId) {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }
  try {
    const input = replaceAvailabilitySchema.parse({
      ...(body as Record<string, unknown>),
      practitionerId,
      requesterUserId: user.id,
    });
    await replaceAvailability({}, input);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toResponse(e);
  }
});
