import { NextRequest, NextResponse } from "next/server";

import { createOffice } from "@/lib/services/team";
import { createOfficeSchema } from "@/lib/schemas/team";
import { readJsonBody } from "@/app/api/errors";
import { withAuth } from "@/app/api/_auth";

/** Création d'un cabinet (devient owner + praticien). */
export const POST = withAuth(async (user, req: NextRequest) => {
  const body = await readJsonBody(req);
  const input = createOfficeSchema.parse({
    ...body,
    userId: user.id,
    userName: user.name,
  });
  const result = await createOffice(input);
  return NextResponse.json(result, { status: 201 });
});
