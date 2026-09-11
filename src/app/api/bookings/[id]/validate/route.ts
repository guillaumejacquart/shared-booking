import { NextRequest, NextResponse } from "next/server";

import { validateBooking } from "@/lib/services/bookings";
import { validateBookingSchema } from "@/lib/schemas/bookings";
import { toResponse } from "@/app/api/errors";
import { getAuthUser, unauthorized } from "@/app/api/_auth";

/** Validation / refus d'une demande en attente (praticien ou owner). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) return unauthorized();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }
  try {
    const input = validateBookingSchema.parse({
      ...(body as Record<string, unknown>),
      bookingId: id,
      requesterUserId: user.id,
    });
    const result = await validateBooking({}, input);
    return NextResponse.json(result);
  } catch (e) {
    return toResponse(e);
  }
}
