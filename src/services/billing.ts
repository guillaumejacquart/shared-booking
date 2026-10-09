import * as membersDal from "@/dal/members";
import * as officesDal from "@/dal/offices";
import * as practitionersDal from "@/dal/practitioners";
import * as usersDal from "@/dal/users";
import { env, isStripeConfigured } from "@/lib/env";
import { ANALYTICS_EVENTS } from "@/lib/analytics";
import type { Ports, StripeSubscriptionLike } from "@/lib/ports";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";

/**
 * Abonnement SaaS (1 par cabinet, payé par le owner, 10 €/mois).
 * Non bloquant (bandeau dashboard) : les réservations restent possibles
 * sans abonnement actif.
 */

const ACTIVE_STATUSES = new Set(["trialing", "active"]);

export interface BillingStatus {
  /** Feature flag : false = abonnement masqué, service complet sans paiement. */
  enabled: boolean;
  configured: boolean;
  priceConfigured: boolean;
  isOwner: boolean;
  active: boolean;
  status: string | null;
  currentPeriodEnd: string | null;
}

async function requireOffice(requesterUserId: string) {
  const prac = await practitionersDal.getPractitionerByUserId(requesterUserId);
  if (!prac) throw new NotFoundError("Profil praticien introuvable");
  const office = await officesDal.getOfficeById(prac.officeId);
  if (!office) throw new NotFoundError("Cabinet introuvable");
  return office;
}

async function requireOwner(requesterUserId: string) {
  const office = await requireOffice(requesterUserId);
  const membership = await membersDal.getMembership(office.id, requesterUserId);
  if (!membership || membership.role !== "owner" || !membership.active) {
    throw new ForbiddenError("Seul le responsable du cabinet gère l'abonnement");
  }
  return office;
}

function toStatus(
  ports: Ports,
  office: { subscriptionStatus: string | null; subscriptionCurrentPeriodEnd: Date | null },
  isOwner: boolean,
): BillingStatus {
  const priceConfigured = Boolean(ports.subscriptionPriceId);
  return {
    enabled: ports.subscriptionEnabled,
    configured: isStripeConfigured,
    priceConfigured,
    isOwner,
    active: Boolean(office.subscriptionStatus && ACTIVE_STATUSES.has(office.subscriptionStatus)),
    status: office.subscriptionStatus,
    currentPeriodEnd: office.subscriptionCurrentPeriodEnd?.toISOString() ?? null,
  };
}

/** État d'abonnement du cabinet (jamais d'erreur si non abonné). */
export async function getBillingStatus(
  ports: Ports,
  requesterUserId: string,
): Promise<BillingStatus> {
  const office = await requireOffice(requesterUserId);
  const membership = await membersDal.getMembership(office.id, requesterUserId);
  return toStatus(ports, office, membership?.role === "owner" && membership.active);
}

/** Crée le customer si besoin puis renvoie l'URL du checkout d'abonnement. */
export async function startSubscriptionCheckout(
  ports: Ports,
  requesterUserId: string,
): Promise<{ url: string }> {
  if (!ports.subscriptionEnabled) {
    throw new ValidationError("Abonnement désactivé sur ce serveur");
  }
  const stripe = ports.stripeClient;
  const priceId = ports.subscriptionPriceId;
  if (!stripe || !priceId) {
    throw new ValidationError("Abonnement non configuré sur ce serveur");
  }
  const office = await requireOwner(requesterUserId);
  let customerId = office.stripeCustomerId;
  if (!customerId) {
    const prac = await practitionersDal.getPractitionerByUserId(requesterUserId);
    const email = prac ? await usersDal.getUserEmail(prac.userId) : null;
    const customer = await stripe.customers.create({
      ...(email ? { email } : {}),
      metadata: { officeId: office.id },
    });
    customerId = customer.id;
    await officesDal.setOfficeSubscription(office.id, {
      stripeCustomerId: customerId,
      stripeSubscriptionId: office.stripeSubscriptionId,
      subscriptionStatus: office.subscriptionStatus,
      subscriptionCurrentPeriodEnd: office.subscriptionCurrentPeriodEnd,
    });
  }
  const origin = env.BETTER_AUTH_URL.replace(/\/$/, "");
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { officeId: office.id },
    success_url: `${origin}/dashboard/parametres?tab=abonnement&abo=ok`,
    cancel_url: `${origin}/dashboard/parametres?tab=abonnement&abo=annule`,
  });
  if (!session.url) throw new ValidationError("Abonnement indisponible pour le moment");
  await ports.analytics.track(ANALYTICS_EVENTS.SUBSCRIPTION_CHECKOUT_STARTED, {});
  return { url: session.url };
}

/** Portail Stripe (factures, moyen de paiement, résiliation). Owner uniquement. */
export async function createPortalSession(
  ports: Ports,
  requesterUserId: string,
): Promise<{ url: string }> {
  if (!ports.subscriptionEnabled) {
    throw new ValidationError("Abonnement désactivé sur ce serveur");
  }
  const stripe = ports.stripeClient;
  if (!stripe) throw new ValidationError("Abonnement non configuré sur ce serveur");
  const office = await requireOwner(requesterUserId);
  if (!office.stripeCustomerId) throw new ValidationError("Aucun abonnement pour ce cabinet");
  const origin = env.BETTER_AUTH_URL.replace(/\/$/, "");
  const session = await stripe.billingPortal.sessions.create({
    customer: office.stripeCustomerId,
    return_url: `${origin}/dashboard/parametres?tab=abonnement`,
  });
  if (!session.url) throw new ValidationError("Portail indisponible pour le moment");
  return { url: session.url };
}

/** Re-synchronise depuis Stripe (retour de checkout, bouton actualiser). */
export async function refreshBillingStatus(
  ports: Ports,
  requesterUserId: string,
): Promise<BillingStatus> {
  if (!ports.subscriptionEnabled) {
    throw new ValidationError("Abonnement désactivé sur ce serveur");
  }
  const stripe = ports.stripeClient;
  if (!stripe) throw new ValidationError("Abonnement non configuré sur ce serveur");
  const office = await requireOwner(requesterUserId);
  if (office.stripeSubscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(office.stripeSubscriptionId);
    await applySubscriptionEvent(subscription);
  }
  return getBillingStatus(ports, requesterUserId);
}

/**
 * Checkout `mode: subscription` terminé : rattache customer + abonnement
 * au cabinet (le statut fin suit via `customer.subscription.*`).
 */
export async function handleSubscriptionCheckout(args: {
  officeId: string;
  customerId: string | null;
  subscriptionId: string | null;
}): Promise<boolean> {
  const office = await officesDal.getOfficeById(args.officeId);
  if (!office) return false;
  await officesDal.setOfficeSubscription(office.id, {
    stripeCustomerId: args.customerId ?? office.stripeCustomerId,
    stripeSubscriptionId: args.subscriptionId ?? office.stripeSubscriptionId,
    subscriptionStatus: office.subscriptionStatus,
    subscriptionCurrentPeriodEnd: office.subscriptionCurrentPeriodEnd,
  });
  return true;
}

/** Persiste l'état d'un abonnement (webhook `customer.subscription.*`). */
export async function applySubscriptionEvent(subscription: StripeSubscriptionLike): Promise<boolean> {
  const office = await officesDal.findOfficeByStripeCustomer(subscription.customer);
  if (!office) return false;
  await officesDal.setOfficeSubscription(office.id, {
    stripeCustomerId: office.stripeCustomerId ?? subscription.customer,
    stripeSubscriptionId: subscription.id,
    subscriptionStatus: subscription.status,
    subscriptionCurrentPeriodEnd: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000)
      : null,
  });
  return true;
}

/** Surface du service facturation (utilisée par les routes via le container). */
export interface BillingService {
  getBillingStatus(requesterUserId: string): ReturnType<typeof getBillingStatus>;
  startSubscriptionCheckout(requesterUserId: string): ReturnType<typeof startSubscriptionCheckout>;
  createPortalSession(requesterUserId: string): ReturnType<typeof createPortalSession>;
  refreshBillingStatus(requesterUserId: string): ReturnType<typeof refreshBillingStatus>;
  handleSubscriptionCheckout: typeof handleSubscriptionCheckout;
  applySubscriptionEvent: typeof applySubscriptionEvent;
}

export function createBillingService(ports: Ports): BillingService {
  return {
    getBillingStatus: (requesterUserId) => getBillingStatus(ports, requesterUserId),
    startSubscriptionCheckout: (requesterUserId) => startSubscriptionCheckout(ports, requesterUserId),
    createPortalSession: (requesterUserId) => createPortalSession(ports, requesterUserId),
    refreshBillingStatus: (requesterUserId) => refreshBillingStatus(ports, requesterUserId),
    handleSubscriptionCheckout,
    applySubscriptionEvent,
  };
}
