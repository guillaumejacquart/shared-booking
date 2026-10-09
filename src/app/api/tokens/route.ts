import { type NextRequest, NextResponse } from "next/server";

import { services } from "@/lib/container";
import { createApiTokenSchema } from "@/lib/schemas/api-tokens";
import { readJsonBody } from "@/app/api/errors";
import { withAuth } from "@/app/api/_auth";

/** Clés d'API du praticien connecté (métadonnées seules, jamais les secrets). */
export const GET = withAuth(async (user) => {
  return NextResponse.json({
    tokens: await services.apiTokens.list({ requesterUserId: user.id }),
  });
});

/**
 * Crée une clé : le secret en clair n'est rendu QU'UNE fois dans cette
 * réponse (à copier aussitôt), puis il n'est plus jamais relisible.
 */
export const POST = withAuth(async (user, req: NextRequest) => {
  const body = await readJsonBody(req);
  const input = createApiTokenSchema.parse({ ...body, requesterUserId: user.id });
  const created = await services.apiTokens.create(input);
  return NextResponse.json(created, { status: 201 });
});
