import { NextResponse } from "next/server";

import { withAuth } from "@/app/api/_auth";
import { services } from "@/lib/container";

/**
 * Démarre (ou reprend) l'onboarding Express : renvoie l'URL Stripe vers
 * laquelle rediriger le praticien (KYC + IBAN gérés par Stripe).
 */
export const POST = withAuth(async (user) => {
  const out = await services.stripeConnect.startConnectOnboarding(user.id);
  return NextResponse.json(out);
});
