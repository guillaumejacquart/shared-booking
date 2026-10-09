import { type NextRequest, NextResponse } from "next/server";

import { toResponse } from "@/app/api/errors";
import { services } from "@/lib/container";
import { checkRateLimit } from "@/lib/rate-limit";
import { hasApiScope, type ResolvedApiToken } from "@/services/api-tokens";
import type { ApiScope } from "@/lib/schemas/api-tokens";

/**
 * Enveloppe les Route Handlers de l'API v1 : authentifie par clé personnelle
 * (`Authorization: Bearer cbpat_…`, 401 si absente/invalide), vérifie le
 * scope requis (403 si lecture seule sur une écriture) puis appelle le
 * handler avec le token résolu. Limite : 300 req/h/clé.
 */
export function unauthorized() {
  return NextResponse.json(
    { error: "Clé d'API manquante ou invalide", code: "UNAUTHORIZED" },
    { status: 401 },
  );
}

function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return null;
  return value.trim();
}

export function withApiToken<Rest extends unknown[]>(
  scope: ApiScope,
  handler: (
    auth: ResolvedApiToken,
    req: NextRequest,
    ...rest: Rest
  ) => Promise<NextResponse>,
): (req: NextRequest, ...rest: Rest) => Promise<NextResponse> {
  return async (req, ...rest) => {
    try {
      const plain = bearerToken(req);
      if (!plain) return unauthorized();
      const auth = await services.apiTokens.resolve(plain);
      if (!auth) return unauthorized();
      if (!hasApiScope(auth.scopes, scope)) {
        return NextResponse.json(
          { error: "Cette clé est en lecture seule", code: "FORBIDDEN" },
          { status: 403 },
        );
      }
      if (!checkRateLimit(`pat:${auth.token.id}`, 300, 3_600_000)) {
        return NextResponse.json(
          { error: "Trop de requêtes, réessayez plus tard", code: "RATE_LIMITED" },
          { status: 429 },
        );
      }
      return await handler(auth, req, ...rest);
    } catch (error) {
      return toResponse(error);
    }
  };
}
