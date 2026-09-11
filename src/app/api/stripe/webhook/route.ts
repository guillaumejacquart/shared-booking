import { NextResponse } from "next/server";
import Stripe from "stripe";

import { db } from "@/db/client";
import { env } from "@/lib/env";
import { applyPaymentCompleted } from "@/lib/services/bookings";

/**
 * Webhook Stripe (paiements Checkout).
 * - `checkout.session.completed` → booking payée (+ confirmée si pas de validation requise).
 * - Événements inconnus / sessions inconnues → 200 (pas de retry inutile).
 * - Signature invalide → 400 (Stripe retry).
 */
export async function POST(req: Request) {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Webhook non configuré" }, { status: 500 });
  }
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Signature manquante" }, { status: 400 });
  }
  let event: Stripe.Event;
  try {
    const stripe = new Stripe(env.STRIPE_SECRET_KEY!);
    const rawBody = await req.text();
    event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return NextResponse.json({ error: "Signature invalide" }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      await applyPaymentCompleted(
        { db },
        {
          stripeSessionId: session.id,
          paymentIntentId:
            typeof session.payment_intent === "string" ? session.payment_intent : null,
        },
      );
    }
    // `checkout.session.expired` : le sweep périodique libère le créneau.
    return NextResponse.json({ received: true });
  } catch (e) {
    console.error("[stripe-webhook]", e);
    return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
  }
}
