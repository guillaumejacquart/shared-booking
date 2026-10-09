import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { withAuth } from "@/app/api/_auth";
import { services } from "@/lib/container";

/**
 * Retour OAuth Standard : finalise la liaison du compte existant puis
 * redirige vers l'onglet Paiements (`stripe=retour`), ou vers ce même
 * onglet avec `stripe=erreur` + message en cas d'échec (accès refusé côté
 * Stripe, `state` invalide/expiré, échange du code impossible…).
 */
export const GET = withAuth(async (user, req: NextRequest) => {
  const back = (query: string) =>
    NextResponse.redirect(new URL(`/dashboard/profil?tab=paiements&${query}`, req.nextUrl.origin));
  const params = req.nextUrl.searchParams;
  if (params.get("error")) return back("stripe=erreur");
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return back("stripe=erreur");
  try {
    await services.stripeConnect.completeStandardOAuth({ code, state }, user.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const query = message
      ? `stripe=erreur&msg=${encodeURIComponent(message.slice(0, 300))}`
      : "stripe=erreur";
    return back(query);
  }
  return back("stripe=retour");
});
