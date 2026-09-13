import { NextRequest, NextResponse } from "next/server";

import { replaceAvailability } from "@/lib/services/schedule";
import { replaceAvailabilitySchema } from "@/lib/schemas/schedule";
import { readJsonBody } from "@/app/api/errors";
import { withAuth } from "@/app/api/_auth";

/** Remplace les disponibilités hebdo d'un praticien (lui-même ou owner). */
export const PUT = withAuth(async (user, req: NextRequest) => {
  const body = await readJsonBody(req);
  const input = replaceAvailabilitySchema.parse({
    ...body,
    requesterUserId: user.id,
  });
  await replaceAvailability(input);
  return NextResponse.json({ ok: true });
});
