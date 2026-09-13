import { NextRequest, NextResponse } from "next/server";

import { createException } from "@/lib/services/schedule";
import { createExceptionSchema } from "@/lib/schemas/schedule";
import { readJsonBody } from "@/app/api/errors";
import { withAuth } from "@/app/api/_auth";

/** Crée une exception (fermeture / ouverture exceptionnelle). */
export const POST = withAuth(async (user, req: NextRequest) => {
  const body = await readJsonBody(req);
  const input = createExceptionSchema.parse({
    ...body,
    requesterUserId: user.id,
  });
  const id = await createException(input);
  return NextResponse.json({ id }, { status: 201 });
});
