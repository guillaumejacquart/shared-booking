import { type NextRequest, NextResponse } from "next/server";

import { services } from "@/lib/container";
import { saveSessionTypeSchema } from "@/lib/schemas/schedule";
import { readJsonBody } from "@/app/api/errors";
import { withAuth } from "@/app/api/_auth";
import { publicVariants } from "./variants";

/** Crée un type de séance. */
export const POST = withAuth(async (user, req: NextRequest) => {
  const body = await readJsonBody(req);
  const input = saveSessionTypeSchema.parse({
    ...body,
    requesterUserId: user.id,
  });
  const { id, variants } = await services.schedule.saveSessionType(input);
  return NextResponse.json({ id, variants: publicVariants(variants) }, { status: 201 });
});
