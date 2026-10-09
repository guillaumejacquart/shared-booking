import { type NextRequest, NextResponse } from "next/server";

import { services } from "@/lib/container";
import { readJsonBody } from "@/app/api/errors";
import {
  apiBookingsQuerySchema,
  apiCreateBookingSchema,
} from "@/lib/schemas/api-tokens";
import { ValidationError } from "@/services/errors";
import { withApiToken } from "../_auth";

/** Fenêtre de lecture : défaut maintenant → +30 j, jamais plus de 93 j. */
function parseWindow(url: URL, now: Date): { start: Date; end: Date; status?: string } {
  const query = apiBookingsQuerySchema.parse({
    start: url.searchParams.get("start") ?? undefined,
    end: url.searchParams.get("end") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
  });
  const start = query.start ? new Date(query.start) : now;
  const end = query.end ? new Date(query.end) : new Date(now.getTime() + 30 * 86_400_000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    throw new ValidationError("Fenêtre temporelle invalide");
  }
  if (end.getTime() - start.getTime() > 93 * 86_400_000) {
    throw new ValidationError("Fenêtre trop large (93 jours maximum)");
  }
  return { start, end, status: query.status };
}

/** Planning du praticien porteur (données patients incluses : c'est SA clé). */
export const GET = withApiToken("read", async (auth, req: NextRequest) => {
  const { start, end, status } = parseWindow(new URL(req.url), new Date());
  const bookings = await services.bookings.listApi(auth.practitioner.id, {
    start,
    end,
    status,
  });
  return NextResponse.json({ bookings });
});

/** Crée un RDV depuis l'outil externe (confirmé direct, salle auto-assignée si omise). */
export const POST = withApiToken("write", async (auth, req: NextRequest) => {
  const body = await readJsonBody(req);
  const input = apiCreateBookingSchema.parse(body);
  const created = await services.bookings.createApi({
    ...input,
    practitionerId: auth.practitioner.id,
  });
  return NextResponse.json(created, { status: 201 });
});
