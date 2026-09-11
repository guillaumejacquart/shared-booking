import { NextRequest, NextResponse } from "next/server";

import { deleteSessionType, saveSessionType } from "@/lib/services/schedule";
import { deleteSessionTypeSchema, saveSessionTypeSchema } from "@/lib/schemas/schedule";
import { toResponse } from "@/app/api/errors";
import { getAuthUser, unauthorized } from "@/app/api/_auth";

/** Modifie un type de séance. */
export async function PATCH(
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
  const practitionerId = (body as { practitionerId?: unknown })?.practitionerId;
  if (typeof practitionerId !== "string" || !practitionerId) {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }
  try {
    const input = saveSessionTypeSchema.parse({
      ...(body as Record<string, unknown>),
      id,
      practitionerId,
      requesterUserId: user.id,
    });
    await saveSessionType({}, input);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toResponse(e);
  }
}

/** Supprime un type de séance (?practitionerId=). */
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
    const input = deleteSessionTypeSchema.parse({
      id,
      practitionerId,
      requesterUserId: user.id,
    });
    await deleteSessionType({}, input);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toResponse(e);
  }
}
