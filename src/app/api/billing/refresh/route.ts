import { NextResponse } from "next/server";

import { withAuth } from "@/app/api/_auth";
import { services } from "@/lib/container";

/** Re-synchronise le statut depuis Stripe (retour de checkout). */
export const POST = withAuth(async (user) => {
  return NextResponse.json(await services.billing.refreshBillingStatus(user.id));
});
