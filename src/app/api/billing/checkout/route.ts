import { NextResponse } from "next/server";

import { withAuth } from "@/app/api/_auth";
import { services } from "@/lib/container";

/**
 * Démarre l'abonnement du cabinet : renvoie l'URL du checkout Stripe
 * (mode subscription, 10 €/mois). Owner uniquement.
 */
export const POST = withAuth(async (user) => {
  return NextResponse.json(await services.billing.startSubscriptionCheckout(user.id));
});
