import { type NextRequest, NextResponse } from "next/server";

import { services } from "@/lib/container";
import { readJsonBody } from "@/app/api/errors";
import { apiCancelBookingSchema } from "@/lib/schemas/api-tokens";
import { withApiToken } from "../../../_auth";

/** Annulation praticien d'un de SES rdvs (motif optionnel, patient notifié). */
export const POST = withApiToken(
  "write",
  async (auth, req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body = await readJsonBody(req);
    const input = apiCancelBookingSchema.parse(body);
    const result = await services.bookings.cancelApi({
      practitionerId: auth.practitioner.id,
      bookingId: id,
      reason: input.reason,
    });
    return NextResponse.json(result);
  },
);
