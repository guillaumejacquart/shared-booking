import { NextRequest, NextResponse } from "next/server";

import { db } from "@/db/client";
import { rescheduleBooking } from "@/lib/services/bookings";
import { rescheduleBookingSchema } from "@/lib/schemas/bookings";
import { toResponse } from "@/app/api/errors";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

/** Report via lien magique. */
export async function POST(req: NextRequest) {
  if (!checkRateLimit(`reschedule:${clientIp(req)}`, 30, 3_600_000)) {
    return NextResponse.json(
      { error: "Trop de tentatives, réessayez plus tard" },
      { status: 429 },
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }
  try {
    const result = await rescheduleBooking({ db }, rescheduleBookingSchema.parse(body));
    return NextResponse.json(result);
  } catch (e) {
    return toResponse(e);
  }
}
