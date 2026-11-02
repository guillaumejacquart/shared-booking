import { type NextRequest, NextResponse } from "next/server";

import { services } from "@/lib/container";
import { selectOfficeSchema } from "@/lib/schemas/team";
import { readJsonBody } from "@/app/api/errors";
import { withAuth } from "@/app/api/_auth";

/** Sélectionne le cabinet courant du backoffice (membre actif uniquement). */
export const PATCH = withAuth(async (user, req: NextRequest) => {
  const body = await readJsonBody(req);
  const result = await services.team.selectOffice(
    selectOfficeSchema.parse({ ...body, requesterUserId: user.id }),
  );
  return NextResponse.json(result);
});
