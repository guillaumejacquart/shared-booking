import { NextRequest, NextResponse } from "next/server";

import { createBooking } from "@/lib/services/bookings";
import { createBookingSchema } from "@/lib/schemas/bookings";
import { readJsonBody, route } from "@/app/api/errors";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

/** Création de réservation publique (patients non connectés). */
export const POST = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) => {
  const { slug } = await params;
  if (!checkRateLimit(`book:${clientIp(req)}`, 20, 3_600_000)) {
    return NextResponse.json(
      { error: "Trop de tentatives, réessayez plus tard" },
      { status: 429 },
    );
  }
  const body = await readJsonBody(req);
  // Honeypot anti-bot : champ invisible que les humains laissent vide.
  if (body.website) {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }
  const input = createBookingSchema.parse({ ...body, practitionerSlug: slug });
  const result = await createBooking({}, input);
  return NextResponse.json(result, { status: 201 });
});
