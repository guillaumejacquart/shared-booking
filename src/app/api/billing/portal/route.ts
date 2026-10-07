import { NextResponse } from "next/server";

import { withAuth } from "@/app/api/_auth";
import { services } from "@/lib/container";

/** Portail Stripe (factures, moyen de paiement, résiliation). Owner uniquement. */
export const POST = withAuth(async (user) => {
  return NextResponse.json(await services.billing.createPortalSession(user.id));
});
