import { NextResponse } from "next/server";

import { withAuth } from "@/app/api/_auth";
import { services } from "@/lib/container";

/**
 * Liaison d'un compte Stripe existant (OAuth Standard) : renvoie l'URL
 * d'autorisation Stripe vers laquelle rediriger le praticien. Le callback
 * (`/api/stripe/connect/callback`) finalise la liaison.
 */
export const GET = withAuth(async (user) => {
  const { url } = await services.stripeConnect.startStandardOAuth(user.id);
  return NextResponse.json({ url });
});
