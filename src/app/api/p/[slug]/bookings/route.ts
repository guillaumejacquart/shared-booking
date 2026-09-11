import { NextRequest, NextResponse } from "next/server";

import { db } from "@/db/client";
import { createBooking } from "@/lib/services/bookings";
import { createBookingSchema } from "@/lib/schemas/bookings";
import { toResponse } from "@/app/api/errors";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

/** Création de réservation publique (patients non connectés). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!checkRateLimit(`book:${clientIp(req)}`, 20, 3_600_000)) {
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
  // Honeypot anti-bot : champ invisible que les humains laissent vide.
  if (
    body &&
    typeof body === "object" &&
    "website" in body &&
    (body as { website?: unknown }).website
  ) {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }
  try {
    const input = createBookingSchema.parse({
      ...(body as Record<string, unknown>),
      practitionerSlug: slug,
    });
    const result = await createBooking({ db }, input);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return toResponse(e);
  }
}
