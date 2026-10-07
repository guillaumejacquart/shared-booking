import { NextResponse } from "next/server";

import { withAuth } from "@/app/api/_auth";
import { services } from "@/lib/container";

/** Re-synchronise les flags depuis Stripe (retour d'onboarding). */
export const POST = withAuth(async (user) => {
  return NextResponse.json(await services.stripeConnect.refreshConnectStatus(user.id));
});
