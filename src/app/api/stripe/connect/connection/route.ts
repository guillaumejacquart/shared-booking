import { NextResponse } from "next/server";

import { withAuth } from "@/app/api/_auth";
import { services } from "@/lib/container";

/** Délie le compte Connect (le compte Stripe continue d'exister côté Stripe). */
export const DELETE = withAuth(async (user) => {
  return NextResponse.json(await services.stripeConnect.disconnectConnect(user.id));
});
