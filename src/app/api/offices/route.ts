import { NextRequest, NextResponse } from "next/server";

import { createOffice } from "@/lib/services/team";
import { createOfficeSchema } from "@/lib/schemas/team";
import { toResponse } from "@/app/api/errors";
import { getAuthUser, unauthorized } from "@/app/api/_auth";

/** Création d'un cabinet (devient owner + praticien). */
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }
  try {
    const input = createOfficeSchema.parse({
      ...(body as Record<string, unknown>),
      userId: user.id,
      userName: user.name,
    });
    const result = await createOffice({}, input);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return toResponse(e);
  }
}
