import { type NextRequest, NextResponse } from "next/server";

import { services } from "@/lib/container";
import { withAuth } from "@/app/api/_auth";
import { roomAvailabilityQuerySchema } from "@/lib/schemas/bookings";

/**
 * Disponibilité praticien + salles à un horaire donné (aide à la saisie
 * manuelle). La garde anti-conflit tranche au submit, pas ici.
 */
export const GET = withAuth(async (user, req: NextRequest) => {
  const url = new URL(req.url);
  const input = roomAvailabilityQuerySchema.parse({
    requesterUserId: user.id,
    sessionTypeId: url.searchParams.get("sessionTypeId") ?? "",
    sessionVariantId: url.searchParams.get("sessionVariantId") ?? undefined,
    startAt: url.searchParams.get("startAt") ?? "",
  });
  return NextResponse.json(await services.bookings.roomAvailability(input));
});
