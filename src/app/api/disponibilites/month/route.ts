import { NextRequest, NextResponse } from "next/server";

import { getAvailabilityMonth } from "@/lib/services/schedule";
import { toResponse } from "@/app/api/errors";
import { withAuth } from "@/app/api/_auth";

/**
 * Données mensuelles pour le calendrier de disponibilités du praticien
 * connecté (règles + exceptions + ses réservations + salles).
 */
export const GET = withAuth(async (user, req: NextRequest) => {
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 42), 1), 62);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }
  try {
    return NextResponse.json(await getAvailabilityMonth({ userId: user.id, from, days }));
  } catch (e) {
    return toResponse(e);
  }
});
