import * as practitionersDal from "@/dal/practitioners";
import type { StripeAccountType } from "@/dal/practitioners";
import * as usersDal from "@/dal/users";
import type { Practitioner } from "@/dal/types";
import { env, isStripeConfigured } from "@/lib/env";
import { ANALYTICS_EVENTS } from "@/lib/analytics";
import type { Ports, StripeAccountLike } from "@/lib/ports";
import {
  buildStandardAuthorizeUrl,
  signConnectState,
  stripeOAuthRedirectUri,
  verifyConnectState,
} from "@/lib/stripe-oauth";
import { NotFoundError, ValidationError } from "./errors";

/**
 * Stripe Connect (destination charges) : chaque praticien lie son propre
 * compte Stripe (`acct_...`) ; la plateforme encaisse puis reverse
 * automatiquement via `transfer_data.destination` au checkout. Deux voies :
 * - Express : la plateforme crée un nouveau compte (`accounts.create`) ;
 * - Standard (OAuth) : le praticien rattache son compte existant.
 * Le checkout (`transfer_data.destination`) fonctionne à l'identique.
 */

export interface StripeConnectStatus {
  configured: boolean;
  /** Paiement en ligne activé (flag SUBSCRIPTION_ENABLED). */
  paymentsEnabled: boolean;
  /** Liaison d'un compte existant (OAuth Standard) proposée. */
  oauthEnabled: boolean;
  accountId: string | null;
  /** 'express' (créé par la plateforme) ou 'standard' (existant, OAuth). */
  accountType: Practitioner["stripeAccountType"] | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  ready: boolean;
}

async function requirePractitioner(requesterUserId: string) {
  const prac = await practitionersDal.getPractitionerByUserId(requesterUserId);
  if (!prac) throw new NotFoundError("Profil praticien introuvable");
  return prac;
}

function toStatus(prac: Practitioner, ports: Ports): StripeConnectStatus {
  const ready = Boolean(prac.stripeAccountId) && prac.stripeChargesEnabled;
  return {
    configured: isStripeConfigured,
    paymentsEnabled: ports.subscriptionEnabled,
    oauthEnabled: ports.stripeOAuth !== null,
    accountId: prac.stripeAccountId,
    accountType: prac.stripeAccountId ? prac.stripeAccountType : null,
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
export async function getConnectStatus(
  ports: Ports,
  requesterUserId: string,
): Promise<StripeConnectStatus> {
  const prac = await requirePractitioner(requesterUserId);
  return toStatus(prac, ports);
}

/**
 * Garde paiement : le flag SUBSCRIPTION_ENABLED couvre toute la monétique
 * (facturation SaaS + Stripe Connect praticiens). Liaison impossible quand
 * il est à false — déliaison et lecture du statut restent permises.
 */
function requirePaymentsEnabled(ports: Ports): void {
  if (!ports.subscriptionEnabled) {
    throw new ValidationError(
      "Paiement en ligne désactivé sur ce serveur (SUBSCRIPTION_ENABLED=false).",
    );
  }
}

/**
 * Clé restreinte sans le droit Connect requis (`more_permissions_required`)
 * → erreur actionnable (FR) au lieu d'un 500 opaque : la correction se fait
 * dans Dashboard Stripe → Developers → API keys, sans redéployer.
 */
function stripePermissionError(error: unknown, need: "read" | "write"): ValidationError | null {
  const shaped = error as { type?: string; raw?: { code?: string } };
  if (shaped?.type !== "StripePermissionError" && shaped?.raw?.code !== "more_permissions_required") {
    return null;
  }
  return new ValidationError(
    need === "write"
      ? "Permission Stripe manquante : la clé doit autoriser Connect en écriture (comptes connectés, « connected_account_write » — Dashboard Stripe → Developers → API keys)."
      : "Permission Stripe manquante : la clé doit autoriser Connect en lecture (comptes connectés — Dashboard Stripe → Developers → API keys).",
  );
}

function throwMappedStripeError(error: unknown, need: "read" | "write"): never {
  const mapped = stripePermissionError(error, need);
  if (mapped) throw mapped;
  throw error;
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
  requirePaymentsEnabled(ports);
  const stripe = requireStripe(ports);
  const prac = await requirePractitioner(requesterUserId);
  let accountId = prac.stripeAccountId;
  if (!accountId) {
    const email = await usersDal.getUserEmail(prac.userId);
    let created: { id: string };
    try {
      created = await stripe.accounts.create({
        type: "express",
        ...(email ? { email } : {}),
        metadata: { practitionerId: prac.id },
      });
    } catch (error) {
      throwMappedStripeError(error, "write");
    }
    accountId = created.id;
    await practitionersDal.setPractitionerStripe(prac.id, {
      stripeAccountId: accountId,
      stripeAccountType: "express",
      stripeChargesEnabled: false,
      stripePayoutsEnabled: false,
    });
  }
  const origin = env.BETTER_AUTH_URL.replace(/\/$/, "");
  let link: { url: string };
  try {
    link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/dashboard/profil?tab=paiements&stripe=refresh`,
      return_url: `${origin}/dashboard/profil?tab=paiements&stripe=retour`,
      type: "account_onboarding",
    });
  } catch (error) {
    throwMappedStripeError(error, "write");
  }
  await ports.analytics.track(ANALYTICS_EVENTS.STRIPE_CONNECT_STARTED, {});
  return { url: link.url, accountId };
}

/** Re-synchronise les flags depuis Stripe (retour d'onboarding, refresh manuel). */
export async function refreshConnectStatus(
  ports: Ports,
  requesterUserId: string,
): Promise<StripeConnectStatus> {
  const prac = await requirePractitioner(requesterUserId);
  if (!prac.stripeAccountId) return toStatus(prac, ports);
  return syncFlags(ports, prac);
}

/** Relit `charges_enabled`/`payouts_enabled` et persiste (Express comme Standard). */
async function syncFlags(ports: Ports, prac: Practitioner): Promise<StripeConnectStatus> {
  const stripe = requireStripe(ports);
  let account: StripeAccountLike;
  try {
    account = await stripe.accounts.retrieve(prac.stripeAccountId as string);
  } catch (error) {
    throwMappedStripeError(error, "read");
  }
  const wasReady = prac.stripeChargesEnabled;
  await practitionersDal.setPractitionerStripe(prac.id, {
    stripeAccountId: prac.stripeAccountId,
    // Ligne lue en base : seules 'express'/'standard' y sont écrites (voir setPractitionerStripe).
    stripeAccountType: prac.stripeAccountType as StripeAccountType,
    stripeChargesEnabled: account.charges_enabled,
    stripePayoutsEnabled: account.payouts_enabled,
  });
  // Transition vers prêt : l'onboarding KYC est terminé, le praticien peut
  // encaisser. Un seul event (pas à chaque refresh manuel).
  if (!wasReady && account.charges_enabled) {
    await ports.analytics.track(ANALYTICS_EVENTS.STRIPE_CONNECT_READY, {});
  }
  return toStatus(
    {
      ...prac,
      stripeChargesEnabled: account.charges_enabled,
      stripePayoutsEnabled: account.payouts_enabled,
    },
    ports,
  );
}

/**
 * Démarre la liaison d'un compte existant (OAuth Standard) : renvoie l'URL
 * Stripe vers laquelle rediriger le praticien. Le `state` signé rattache le
 * retour au praticien (vérifié au callback, en plus de la session).
 */
export async function startStandardOAuth(
  ports: Ports,
  requesterUserId: string,
): Promise<{ url: string }> {
  const oauth = ports.stripeOAuth;
  if (!oauth) {
    throw new ValidationError(
      "Liaison d'un compte existant non configurée sur ce serveur (STRIPE_CLIENT_ID manquant).",
    );
  }
  requirePaymentsEnabled(ports);
  requireStripe(ports);
  const prac = await requirePractitioner(requesterUserId);
  if (prac.stripeAccountId) {
    throw new ValidationError("Un compte Stripe est déjà lié — déliez-le d'abord.");
  }
  const email = await usersDal.getUserEmail(prac.userId);
  const state = signConnectState(prac.id, oauth.stateSecret, ports.clock.now().getTime());
  return {
    url: buildStandardAuthorizeUrl({
      clientId: oauth.clientId,
      redirectUri: stripeOAuthRedirectUri(env.BETTER_AUTH_URL),
      state,
      email,
    }),
  };
}

/**
 * Retour OAuth Standard (`GET /api/stripe/connect/callback`) : vérifie le
 * `state`, échange le code contre le `stripe_user_id` et le stocke.
 * Idempotent : rejouer le callback (refresh navigateur) resynchronise
 * simplement les flags.
 */
export async function completeStandardOAuth(
  ports: Ports,
  input: { code: string; state: string },
  requesterUserId: string,
): Promise<StripeConnectStatus> {
  requirePaymentsEnabled(ports);
  const oauth = ports.stripeOAuth;
  if (!oauth) {
    throw new ValidationError(
      "Liaison d'un compte existant non configurée sur ce serveur (STRIPE_CLIENT_ID manquant).",
    );
  }
  const stripe = requireStripe(ports);
  const practitionerId = verifyConnectState(input.state, oauth.stateSecret, ports.clock.now().getTime());
  if (!practitionerId) {
    throw new ValidationError("Lien de liaison invalide ou expiré — recommencez depuis l'onglet Paiements.");
  }
  const prac = await requirePractitioner(requesterUserId);
  if (prac.id !== practitionerId) {
    throw new ValidationError("Lien de liaison invalide — recommencez depuis l'onglet Paiements.");
  }
  if (!prac.stripeAccountId) {
    let token: { stripe_user_id: string };
    try {
      token = await stripe.oauth.token({ grant_type: "authorization_code", code: input.code });
    } catch {
      throw new ValidationError("Échange OAuth Stripe impossible — recommencez la liaison.");
    }
    if (!token.stripe_user_id) {
      throw new ValidationError("Réponse OAuth Stripe incomplète — recommencez la liaison.");
    }
    await practitionersDal.setPractitionerStripe(prac.id, {
      stripeAccountId: token.stripe_user_id,
      stripeAccountType: "standard",
      stripeChargesEnabled: false,
      stripePayoutsEnabled: false,
    });
    await ports.analytics.track(ANALYTICS_EVENTS.STRIPE_CONNECT_STARTED, {});
  }
  return syncFlags(ports, await requirePractitioner(requesterUserId));
}

/**
 * Délie le compte. Standard : révoque aussi l'accès plateforme côté Stripe
 * (best-effort) ; le compte du praticien continue d'exister dans tous les
 * cas. Express : le compte créé par la plateforme reste tel quel.
 */
export async function disconnectConnect(ports: Ports, requesterUserId: string): Promise<StripeConnectStatus> {
  const prac = await requirePractitioner(requesterUserId);
  if (prac.stripeAccountId && prac.stripeAccountType === "standard" && ports.stripeOAuth && ports.stripeClient) {
    await ports.stripeClient.oauth
      .deauthorize({ client_id: ports.stripeOAuth.clientId, stripe_user_id: prac.stripeAccountId })
      .catch(() => null);
  }
  await practitionersDal.setPractitionerStripe(prac.id, {
    stripeAccountId: null,
    stripeAccountType: "express",
    stripeChargesEnabled: false,
    stripePayoutsEnabled: false,
  });
  return toStatus(
    { ...prac, stripeAccountId: null, stripeChargesEnabled: false, stripePayoutsEnabled: false },
    ports,
  );
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
    stripeAccountType: prac.stripeAccountType as StripeAccountType,
    stripeChargesEnabled: account.charges_enabled,
    stripePayoutsEnabled: account.payouts_enabled,
  });
  return true;
}

/** Surface du service Connect (utilisée par les routes via le container). */
export interface StripeConnectService {
  getConnectStatus(requesterUserId: string): ReturnType<typeof getConnectStatus>;
  startConnectOnboarding(requesterUserId: string): ReturnType<typeof startConnectOnboarding>;
  startStandardOAuth(requesterUserId: string): ReturnType<typeof startStandardOAuth>;
  completeStandardOAuth(
    input: { code: string; state: string },
    requesterUserId: string,
  ): ReturnType<typeof completeStandardOAuth>;
  refreshConnectStatus(requesterUserId: string): ReturnType<typeof refreshConnectStatus>;
  disconnectConnect(requesterUserId: string): ReturnType<typeof disconnectConnect>;
  handleAccountUpdated: typeof handleAccountUpdated;
}

export function createStripeConnectService(ports: Ports): StripeConnectService {
  return {
    getConnectStatus: (requesterUserId) => getConnectStatus(ports, requesterUserId),
    startConnectOnboarding: (requesterUserId) => startConnectOnboarding(ports, requesterUserId),
    startStandardOAuth: (requesterUserId) => startStandardOAuth(ports, requesterUserId),
    completeStandardOAuth: (input, requesterUserId) => completeStandardOAuth(ports, input, requesterUserId),
    refreshConnectStatus: (requesterUserId) => refreshConnectStatus(ports, requesterUserId),
    disconnectConnect: (requesterUserId) => disconnectConnect(ports, requesterUserId),
    handleAccountUpdated,
  };
}
