import { NextResponse } from "next/server";

import { withApiToken } from "../_auth";

/** Identité du porteur : contrôle de validité d'une clé pour les intégrations. */
export const GET = withApiToken("read", async (auth) => {
  const practitioner = auth.practitioner;
  return NextResponse.json({
    practitioner: {
      id: practitioner.id,
      displayName: practitioner.displayName,
      slug: practitioner.slug,
    },
    scopes: auth.scopes,
    token: {
      id: auth.token.id,
      name: auth.token.name,
      prefix: auth.token.tokenPrefix,
      expiresAt: auth.token.expiresAt?.toISOString() ?? null,
    },
  });
});
