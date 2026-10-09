import * as practitionersDal from "@/dal/practitioners";
import * as usersDal from "@/dal/users";
import { env, isStripeConfigured } from "@/lib/env";
import { ANALYTICS_EVENTS } from "@/lib/analytics";
import type { Ports, StripeAccountLike } from "@/lib/ports";
import { NotFoundError, ValidationError } from "./errors";

/**
 * Stripe Connect Express (destination charges) : chaque praticien lie son
 * propre compte Stripe (`acct_...`) ; la plateforme encaisse puis reverse
 * automatiquement via `transfer_data.destination` au checkout.
 */

export interface StripeConnectStatus {
  configured: boolean;
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  ready: boolean;
}

async function requirePractitioner(requesterUserId: string) {
  const prac = await practitionersDal.getPractitionerByUserId(requesterUserId);
  if (!prac) throw new NotFoundError("Profil praticien introuvable");
  return prac;
}

function toStatus(
  prac: { stripeAccountId: string | null; stripeChargesEnabled: boolean; stripePayoutsEnabled: boolean },
): StripeConnectStatus {
  const ready = Boolean(prac.stripeAccountId) && prac.stripeChargesEnabled;
  return {
    configured: isStripeConfigured,
    accountId: prac.stripeAccountId,
    chargesEnabled: prac.stripeChargesEnabled,
    payoutsEnabled: prac.stripePayoutsEnabled,
    ready,
  };
}

function requireStripe(ports: Ports) {
  // Même règle que la réservation : le fake injecté fait foi (tests),
  // en prod le container ne fournit un client que si la clé est présente.
  if (!ports.stripeClient) {
    throw new ValidationError("Paiement en ligne non configuré sur ce serveur");
  }
  return ports.stripeClient;
}

/** État Connect du praticien connecté (jamais d'erreur si non lié). */
export async function getConnectStatus(requesterUserId: string): Promise<StripeConnectStatus> {
  const prac = await requirePractitioner(requesterUserId);
  return toStatus(prac);
}

/**
 * Démarre (ou reprend) l'onboarding Express : crée le compte `acct_...`
 * s'il n'existe pas, puis renvoie l'URL Stripe vers laquelle rediriger le
 * praticien (KYC + IBAN gérés par Stripe).
 */
export async function startConnectOnboarding(
  ports: Ports,
  requesterUserId: string,
): Promise<{ url: string; accountId: string }> {
  const stripe = requireStripe(ports);
  const prac = await requirePractitioner(requesterUserId);
  let accountId = prac.stripeAccountId;
  if (!accountId) {
    const email = await usersDal.getUserEmail(prac.userId);
    const created = await stripe.accounts.create({
      type: "express",
      ...(email ? { email } : {}),
      metadata: { practitionerId: prac.id },
    });
    accountId = created.id;
    await practitionersDal.setPractitionerStripe(prac.id, {
      stripeAccountId: accountId,
      stripeChargesEnabled: false,
      stripePayoutsEnabled: false,
    });
  }
  const origin = env.BETTER_AUTH_URL.replace(/\/$/, "");
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${origin}/dashboard/profil?tab=paiements&stripe=refresh`,
    return_url: `${origin}/dashboard/profil?tab=paiements&stripe=retour`,
    type: "account_onboarding",
  });
  await ports.analytics.track(ANALYTICS_EVENTS.STRIPE_CONNECT_STARTED, {});
  return { url: link.url, accountId };
}

/** Re-synchronise les flags depuis Stripe (retour d'onboarding, refresh manuel). */
export async function refreshConnectStatus(
  ports: Ports,
  requesterUserId: string,
): Promise<StripeConnectStatus> {
  const stripe = requireStripe(ports);
  const prac = await requirePractitioner(requesterUserId);
  if (!prac.stripeAccountId) return toStatus(prac);
  const wasReady = prac.stripeChargesEnabled;
  const account = await stripe.accounts.retrieve(prac.stripeAccountId);
  await practitionersDal.setPractitionerStripe(prac.id, {
    stripeAccountId: prac.stripeAccountId,
    stripeChargesEnabled: account.charges_enabled,
    stripePayoutsEnabled: account.payouts_enabled,
  });
  // Transition vers prêt : l'onboarding KYC est terminé, le praticien peut
  // encaisser. Un seul event (pas à chaque refresh manuel).
  if (!wasReady && account.charges_enabled) {
    await ports.analytics.track(ANALYTICS_EVENTS.STRIPE_CONNECT_READY, {});
  }
  return toStatus({
    stripeAccountId: prac.stripeAccountId,
    stripeChargesEnabled: account.charges_enabled,
    stripePayoutsEnabled: account.payouts_enabled,
  });
}

/** Délie le compte (le compte Stripe continue d'exister côté Stripe). */
export async function disconnectConnect(requesterUserId: string): Promise<StripeConnectStatus> {
  const prac = await requirePractitioner(requesterUserId);
  await practitionersDal.setPractitionerStripe(prac.id, {
    stripeAccountId: null,
    stripeChargesEnabled: false,
    stripePayoutsEnabled: false,
  });
  return toStatus({ stripeAccountId: null, stripeChargesEnabled: false, stripePayoutsEnabled: false });
}

/**
 * Webhook `account.updated` : met à jour les flags du praticien propriétaire.
 * Retourne false si le compte est inconnu (ignoré, pas de retry).
 */
export async function handleAccountUpdated(account: StripeAccountLike): Promise<boolean> {
  const prac = await practitionersDal.findPractitionerByStripeAccount(account.id);
  if (!prac) return false;
  await practitionersDal.setPractitionerStripe(prac.id, {
    stripeAccountId: prac.stripeAccountId,
    stripeChargesEnabled: account.charges_enabled,
    stripePayoutsEnabled: account.payouts_enabled,
  });
  return true;
}

/** Surface du service Connect (utilisée par les routes via le container). */
export interface StripeConnectService {
  getConnectStatus: typeof getConnectStatus;
  startConnectOnboarding(requesterUserId: string): ReturnType<typeof startConnectOnboarding>;
  refreshConnectStatus(requesterUserId: string): ReturnType<typeof refreshConnectStatus>;
  disconnectConnect: typeof disconnectConnect;
  handleAccountUpdated: typeof handleAccountUpdated;
}

export function createStripeConnectService(ports: Ports): StripeConnectService {
  return {
    getConnectStatus,
    startConnectOnboarding: (requesterUserId) => startConnectOnboarding(ports, requesterUserId),
    refreshConnectStatus: (requesterUserId) => refreshConnectStatus(ports, requesterUserId),
    disconnectConnect,
    handleAccountUpdated,
  };
}
