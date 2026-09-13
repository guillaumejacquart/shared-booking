import { NextRequest, NextResponse } from "next/server";

import { getAvailableSlots } from "@/lib/services/bookings";
import { slotsQuerySchema } from "@/lib/schemas/bookings";
import { route } from "@/app/api/errors";

/** Créneaux publics d'un praticien pour un type de séance. */
export const GET = route(async (
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) => {
  const { slug } = await params;
  const url = new URL(req.url);
  const input = slotsQuerySchema.parse({
    practitionerSlug: slug,
    sessionTypeId: url.searchParams.get("sessionTypeId") ?? "",
    fromDate: url.searchParams.get("from") ?? new Date().toISOString().slice(0, 10),
    days: url.searchParams.get("days") ?? undefined,
  });
  const slots = await getAvailableSlots({}, input);
  return NextResponse.json({ slots });
});
