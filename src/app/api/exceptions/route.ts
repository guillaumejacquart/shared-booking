import { NextRequest, NextResponse } from "next/server";

import { db } from "@/db/client";
import { createException } from "@/lib/services/schedule";
import { createExceptionSchema } from "@/lib/schemas/schedule";
import { toResponse } from "@/app/api/errors";
import { getAuthUser, unauthorized } from "@/app/api/_auth";
import { practitionerScope } from "@/app/api/_team";

/** Crée une exception (fermeture / ouverture exceptionnelle). */
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
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
  const scope = await practitionerScope(practitionerId, user.id);
  if ("error" in scope) return scope.error;
  try {
    const input = createExceptionSchema.parse({
      ...(body as Record<string, unknown>),
      practitionerId,
      officeId: scope.officeId,
      requesterUserId: user.id,
      requesterIsOwner: scope.isOwner,
    });
    const id = await createException({ db }, input);
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return toResponse(e);
  }
}
