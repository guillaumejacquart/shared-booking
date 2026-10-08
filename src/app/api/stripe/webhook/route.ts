import { NextResponse } from "next/server";
import Stripe from "stripe";

import { env } from "@/lib/env";
import { services } from "@/lib/container";

/**
 * Webhook Stripe (paiements Checkout + Connect + abonnement SaaS).
 * - `checkout.session.completed` (payment) → booking payée (+ confirmée si pas de validation requise).
 * - `checkout.session.completed` (subscription) → rattache l'abo au cabinet.
 * - `customer.subscription.*` → statut d'abonnement du cabinet.
 * - `account.updated` → flags Connect du praticien propriétaire.
 * - Événements inconnus / sessions inconnues → 200 (pas de retry inutile).
 * - Signature invalide → 400 (Stripe retry).
 */
export async function POST(req: Request) {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Webhook non configuré" }, { status: 500 });
  }
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Signature manquante" }, { status: 400 });
  }
  let event: Stripe.Event;
  try {
    const stripe = new Stripe(env.STRIPE_SECRET_KEY);
    const rawBody = await req.text();
    event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return NextResponse.json({ error: "Signature invalide" }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription") {
        const metadata = (session.metadata ?? {}) as Record<string, string>;
        await services.billing.handleSubscriptionCheckout({
          officeId: metadata.officeId ?? "",
          customerId: typeof session.customer === "string" ? session.customer : null,
          subscriptionId:
            typeof session.subscription === "string" ? session.subscription : null,
        });
      } else {
        await services.bookings.applyPayment({
          stripeSessionId: session.id,
          paymentIntentId:
            typeof session.payment_intent === "string" ? session.payment_intent : null,
        });
      }
    } else if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const subscription = event.data.object as Stripe.Subscription;
      // SDK récent : la fin de période vit sur le premier item, plus sur l'abo.
      const firstItem = subscription.items.data[0];
      await services.billing.applySubscriptionEvent({
        id: subscription.id,
        customer:
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer.id,
        status: subscription.status,
        current_period_end: firstItem?.current_period_end ?? null,
      });
    } else if (event.type === "account.updated") {
      const account = event.data.object as Stripe.Account;
      await services.stripeConnect.handleAccountUpdated({
        id: account.id,
        charges_enabled: account.charges_enabled,
        payouts_enabled: account.payouts_enabled,
      });
    }
    // `checkout.session.expired` : le sweep périodique libère le créneau.
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[stripe-webhook]", error);
    return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
  }
}
