import { type NextRequest, NextResponse } from "next/server";

import { services } from "@/lib/container";
import { validateBookingByTokenSchema } from "@/lib/schemas/bookings";
import { readJsonBody, route } from "@/app/api/errors";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

/** Validation / refus via lien magique praticien (email de demande, sans connexion). */
export const POST = route(async (req: NextRequest) => {
  if (!checkRateLimit(`validate:${clientIp(req)}`, 30, 3_600_000)) {
    return NextResponse.json(
      { error: "Trop de tentatives, réessayez plus tard" },
      { status: 429 },
    );
  }
  const body = await readJsonBody(req);
  const result = await services.bookings.validateByToken(validateBookingByTokenSchema.parse(body));
  return NextResponse.json(result);
});
