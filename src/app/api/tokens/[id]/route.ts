import { type NextRequest, NextResponse } from "next/server";

import { services } from "@/lib/container";
import { revokeApiTokenSchema } from "@/lib/schemas/api-tokens";
import { withAuth } from "@/app/api/_auth";

/** Révoque une clé (les intégrations l'utilisant reçoivent 401). */
export const DELETE = withAuth(
  async (user, _req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const input = revokeApiTokenSchema.parse({
      tokenId: id,
      requesterUserId: user.id,
    });
    return NextResponse.json(await services.apiTokens.revoke(input));
  },
);
