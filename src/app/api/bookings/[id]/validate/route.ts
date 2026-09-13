import { NextRequest, NextResponse } from "next/server";

import { validateBooking } from "@/lib/services/bookings";
import { validateBookingSchema } from "@/lib/schemas/bookings";
import { readJsonBody } from "@/app/api/errors";
import { withAuth } from "@/app/api/_auth";

/** Validation / refus d'une demande en attente (praticien ou owner). */
export const POST = withAuth(async (user, req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const body = await readJsonBody(req);
  const input = validateBookingSchema.parse({
    ...body,
    bookingId: id,
    requesterUserId: user.id,
  });
  const result = await validateBooking({}, input);
  return NextResponse.json(result);
});
