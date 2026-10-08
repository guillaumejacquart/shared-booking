import { NextResponse } from "next/server";

import { services } from "@/lib/container";
import { readJsonBody } from "@/app/api/errors";
import { withAuth } from "@/app/api/_auth";
import { manualBookingSchema } from "@/lib/schemas/bookings";

/** Crée une réservation manuelle (praticien connecté, pour soi). */
export const POST = withAuth(async (user, req) => {
  const body = await readJsonBody(req);
  const input = manualBookingSchema.parse({ ...body, requesterUserId: user.id });
  const created = await services.bookings.createManual(input);
  return NextResponse.json(created, { status: 201 });
});
