import { NextRequest, NextResponse } from "next/server";

import { saveSessionType } from "@/lib/services/schedule";
import { saveSessionTypeSchema } from "@/lib/schemas/schedule";
import { toResponse } from "@/app/api/errors";
import { withAuth } from "@/app/api/_auth";

/** Crée un type de séance. */
export const POST = withAuth(async (user, req: NextRequest) => {
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
    const input = saveSessionTypeSchema.parse({
      ...(body as Record<string, unknown>),
      practitionerId,
      requesterUserId: user.id,
    });
    const id = await saveSessionType({}, input);
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return toResponse(e);
  }
});
