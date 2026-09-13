import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/session";
import { toResponse } from "./errors";

/** Utilisateur connecté ou null (la route répond 401). */
export async function getAuthUser() {
  const session = await getSession();
  return session?.user ?? null;
}

export type AuthUser = NonNullable<Awaited<ReturnType<typeof getAuthUser>>>;

export function unauthorized() {
  return NextResponse.json({ error: "Connexion requise" }, { status: 401 });
}

/**
 * Enveloppe les Route Handlers protégés : authentifie (401 si anonyme) puis
 * appelle le handler avec l'utilisateur en premier argument. Toute erreur
 * levée (validation, métier, inconnue) est mappée par `toResponse`. Les routes
 * publiques (réservation, webhooks, tokens) n'utilisent pas ce wrapper.
 */
export function withAuth<Rest extends unknown[]>(
  handler: (user: AuthUser, req: NextRequest, ...rest: Rest) => Promise<NextResponse>,
): (req: NextRequest, ...rest: Rest) => Promise<NextResponse> {
  return async (req, ...rest) => {
    try {
      const user = await getAuthUser();
      if (!user) return unauthorized();
      return await handler(user, req, ...rest);
    } catch (e) {
      return toResponse(e);
    }
  };
}
