import { type NextRequest, NextResponse } from "next/server";

import { services } from "@/lib/container";
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
  const id = await services.schedule.createException(input);
  return NextResponse.json({ id }, { status: 201 });
});
