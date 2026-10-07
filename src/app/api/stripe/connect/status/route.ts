import { NextResponse } from "next/server";

import { withAuth } from "@/app/api/_auth";
import { services } from "@/lib/container";

/** État Connect du praticien connecté. */
export const GET = withAuth(async (user) => {
  return NextResponse.json(await services.stripeConnect.getConnectStatus(user.id));
});
