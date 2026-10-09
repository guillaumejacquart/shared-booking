import { type NextRequest, NextResponse } from "next/server";

import { services } from "@/lib/container";
import { slotsQuerySchema } from "@/lib/schemas/bookings";
import { withApiToken } from "../_auth";

/** Créneaux du praticien porteur (`sessionTypeId` requis, comme l'API publique). */
export const GET = withApiToken("read", async (auth, req: NextRequest) => {
  const url = new URL(req.url);
  const input = slotsQuerySchema.parse({
    practitionerSlug: auth.practitioner.slug,
    sessionTypeId: url.searchParams.get("sessionTypeId") ?? "",
    sessionVariantId: url.searchParams.get("variantId") ?? undefined,
    fromDate: url.searchParams.get("from") ?? new Date().toISOString().slice(0, 10),
    days: url.searchParams.get("days") ?? undefined,
  });
  const slots = await services.bookings.availableSlots(input);
  return NextResponse.json({ slots });
});
