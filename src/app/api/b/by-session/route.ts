import { type NextRequest, NextResponse } from "next/server";

import { services } from "@/lib/container";

/** Statut d'une réservation payée, pour la page de retour Stripe. */
export async function GET(req: NextRequest) {
  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }
  const status = await services.bookings.statusByStripeSession(sessionId);
  if (!status) return NextResponse.json({ error: "Réservation introuvable" }, { status: 404 });
  return NextResponse.json(status);
}
