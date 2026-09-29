import { type NextRequest, NextResponse } from "next/server";

import { services } from "@/lib/container";
import { deleteExceptionSchema } from "@/lib/schemas/schedule";
import { withAuth } from "@/app/api/_auth";

/** Supprime une exception (?practitionerId=). */
export const DELETE = withAuth(async (user, req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const input = deleteExceptionSchema.parse({
    id,
    practitionerId: new URL(req.url).searchParams.get("practitionerId"),
    requesterUserId: user.id,
  });
  await services.schedule.deleteException(input);
  return NextResponse.json({ ok: true });
});
