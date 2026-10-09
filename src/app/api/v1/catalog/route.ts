import { NextResponse } from "next/server";

import { services } from "@/lib/container";
import { withApiToken } from "../_auth";

/** Catalogue d'une intégration : séances actives (+ déclinaisons) et salles attribuables. */
export const GET = withApiToken("read", async (auth) => {
  return NextResponse.json(await services.bookings.catalog(auth.practitioner.id));
});
