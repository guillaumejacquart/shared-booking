import { type NextRequest, NextResponse } from "next/server";

import { withAuth } from "@/app/api/_auth";
import { readJsonBody } from "@/app/api/errors";
import { services } from "@/lib/container";
import { saveGooglePrefsSchema } from "@/lib/schemas/google";

/** État de connexion Google + préférences de push du praticien connecté. */
export const GET = withAuth(async (user) => {
  return NextResponse.json(await services.google.getGoogleStatus(user.id));
});

export const PATCH = withAuth(async (user, req: NextRequest) => {
  const body = await readJsonBody(req);
  const input = saveGooglePrefsSchema.parse({ ...body, requesterUserId: user.id });
  return NextResponse.json(await services.google.saveGooglePrefs(input));
});
