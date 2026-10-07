import { NextResponse } from "next/server";

import { withAuth } from "@/app/api/_auth";
import { services } from "@/lib/container";

/** État d'abonnement du cabinet. */
export const GET = withAuth(async (user) => {
  return NextResponse.json(await services.billing.getBillingStatus(user.id));
});
