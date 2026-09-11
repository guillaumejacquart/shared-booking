import { NextResponse } from "next/server";

import { db } from "@/db/client";
import * as invitesDal from "@/dal/invites";
import * as officesDal from "@/dal/offices";
import { acceptInvite } from "@/lib/services/team";
import { acceptInviteSchema } from "@/lib/schemas/team";
import { toResponse } from "@/app/api/errors";
import { getAuthUser, unauthorized } from "@/app/api/_auth";

/** Infos publiques d'une invitation (le token fait office de secret). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const inv = await invitesDal.getInviteByToken(db, token);
  if (!inv) return NextResponse.json({ error: "Invitation introuvable" }, { status: 404 });
  const office = await officesDal.getOfficeById(db, inv.officeId);
  return NextResponse.json({
    officeName: office?.name ?? "",
    email: inv.email,
    expired: inv.expiresAt.getTime() < Date.now(),
    accepted: inv.acceptedAt !== null,
  });
}

/** Acceptation (connecté, email correspondant). */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    const input = acceptInviteSchema.parse({
      token,
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
    });
    const result = await acceptInvite({ db }, input);
    return NextResponse.json(result);
  } catch (e) {
    return toResponse(e);
  }
}
