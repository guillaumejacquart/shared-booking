import { NextRequest, NextResponse } from "next/server";

import { acceptInvite, getInvitePublicInfo } from "@/lib/services/team";
import { acceptInviteSchema } from "@/lib/schemas/team";
import { withAuth } from "@/app/api/_auth";

/** Infos publiques d'une invitation (le token fait office de secret). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const info = await getInvitePublicInfo({}, token);
  if (!info) return NextResponse.json({ error: "Invitation introuvable" }, { status: 404 });
  return NextResponse.json(info);
}

/** Acceptation (connecté, email correspondant). */
export const POST = withAuth(async (
  user,
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) => {
  const { token } = await params;
  const input = acceptInviteSchema.parse({
    token,
    userId: user.id,
    userEmail: user.email,
    userName: user.name,
  });
  const result = await acceptInvite({}, input);
  return NextResponse.json(result);
});
