import { NextRequest, NextResponse } from "next/server";

import { createInvite, listPendingInvites } from "@/lib/services/team";
import { createInviteSchema } from "@/lib/schemas/team";
import { toResponse } from "@/app/api/errors";
import { withAuth } from "@/app/api/_auth";

/** Invitations en attente (owner). */
export const GET = withAuth(async (user, _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  try {
    return NextResponse.json(
      await listPendingInvites({ officeId: id, requesterUserId: user.id }),
    );
  } catch (e) {
    return toResponse(e);
  }
});

/** Inviter un praticien par email (owner). */
export const POST = withAuth(async (user, req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  try {
    const input = createInviteSchema.parse({
      ...(body as Record<string, unknown>),
      officeId: id,
      requesterUserId: user.id,
      origin: `${proto}://${host}`,
    });
    const result = await createInvite({}, input);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return toResponse(e);
  }
});
