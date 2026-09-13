import { NextRequest, NextResponse } from "next/server";

import { saveSessionType } from "@/lib/services/schedule";
import { saveSessionTypeSchema } from "@/lib/schemas/schedule";
import { readJsonBody } from "@/app/api/errors";
import { withAuth } from "@/app/api/_auth";

/** Crée un type de séance. */
export const POST = withAuth(async (user, req: NextRequest) => {
  const body = await readJsonBody(req);
  const input = saveSessionTypeSchema.parse({
    ...body,
    requesterUserId: user.id,
  });
  const id = await saveSessionType(input);
  return NextResponse.json({ id }, { status: 201 });
});
