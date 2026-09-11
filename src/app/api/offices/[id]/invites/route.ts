import { NextRequest, NextResponse } from "next/server";

import * as invitesDal from "@/dal/invites";
import * as membersDal from "@/dal/members";
import { createInvite } from "@/lib/services/team";
import { createInviteSchema } from "@/lib/schemas/team";
import { toResponse } from "@/app/api/errors";
import { getAuthUser, unauthorized } from "@/app/api/_auth";

async function requireOwner(officeId: string, userId: string) {
  const membership = await membersDal.getMembership(officeId, userId);
  return membership && membership.role === "owner" && membership.active
    ? membership
    : null;
}

/** Invitations en attente (owner). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (!(await requireOwner(id, user.id))) {
    return NextResponse.json({ error: "Action non autorisée" }, { status: 403 });
  }
  const invites = await invitesDal.listPendingInvites(id);
  return NextResponse.json({
    invites: invites.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: i.expiresAt.toISOString(),
    })),
  });
}

/** Inviter un praticien par email (owner). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) return unauthorized();
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
}
