import { NextRequest, NextResponse } from "next/server";

import { deleteSessionType, saveSessionType } from "@/lib/services/schedule";
import { deleteSessionTypeSchema, saveSessionTypeSchema } from "@/lib/schemas/schedule";
import { readJsonBody } from "@/app/api/errors";
import { withAuth } from "@/app/api/_auth";

/** Modifie un type de séance. */
export const PATCH = withAuth(async (user, req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const body = await readJsonBody(req);
  const input = saveSessionTypeSchema.parse({
    ...body,
    id,
    requesterUserId: user.id,
  });
  await saveSessionType(input);
  return NextResponse.json({ ok: true });
});

/** Supprime un type de séance (?practitionerId=). */
export const DELETE = withAuth(async (user, req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const input = deleteSessionTypeSchema.parse({
    id,
    practitionerId: new URL(req.url).searchParams.get("practitionerId"),
    requesterUserId: user.id,
  });
  await deleteSessionType(input);
  return NextResponse.json({ ok: true });
});
