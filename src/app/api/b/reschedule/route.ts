import { NextRequest, NextResponse } from "next/server";

import { rescheduleBooking } from "@/lib/services/bookings";
import { rescheduleBookingSchema } from "@/lib/schemas/bookings";
import { readJsonBody, route } from "@/app/api/errors";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

/** Report via lien magique. */
export const POST = route(async (req: NextRequest) => {
  if (!checkRateLimit(`reschedule:${clientIp(req)}`, 30, 3_600_000)) {
    return NextResponse.json(
      { error: "Trop de tentatives, réessayez plus tard" },
      { status: 429 },
    );
  }
  const body = await readJsonBody(req);
  const result = await rescheduleBooking({}, rescheduleBookingSchema.parse(body));
  return NextResponse.json(result);
});
