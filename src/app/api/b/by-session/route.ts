import { NextRequest, NextResponse } from "next/server";

import { db } from "@/db/client";
import * as bookingsDal from "@/dal/bookings";

/**
 * Statut d'une réservation payée, pour la page de retour Stripe.
 * `session_id` fait office de secret (indevinable).
 */
export async function GET(req: NextRequest) {
  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }
  const detail = await bookingsDal.findBookingByStripeSession(db, sessionId);
  if (!detail) return NextResponse.json({ error: "Réservation introuvable" }, { status: 404 });
  const { booking: b, practitioner: prac } = detail;
  return NextResponse.json({
    status: b.status,
    paymentStatus: b.paymentStatus,
    practitionerSlug: prac.slug,
    sessionName: b.sessionNameSnapshot,
    startAt: b.startAt.toISOString(),
  });
}
