import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * OAuth Connect Standard (liaison d'un compte Stripe existant) : construction
 * de l'URL d'autorisation et signature du `state` anti-CSRF. Pur et testé ;
 * l'échange du code et le stockage vivent dans `services/stripe-connect.ts`.
 */

export const STRIPE_OAUTH_AUTHORIZE_URL = "https://connect.stripe.com/oauth/authorize";
export const STRIPE_OAUTH_SCOPE = "read_write";
/** Durée de vie du `state` : 15 minutes. */
export const CONNECT_STATE_TTL_MS = 15 * 60 * 1000;

export function stripeOAuthRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/stripe/connect/callback`;
}

/** URL vers laquelle rediriger le praticien (« Connecter mon compte existant »). */
export function buildStandardAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  email?: string | null;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    scope: STRIPE_OAUTH_SCOPE,
    redirect_uri: input.redirectUri,
    state: input.state,
  });
  if (input.email) params.set("stripe_user[email]", input.email);
  return `${STRIPE_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * `state` signé : `v1.<practitionerId>.<issuedAtMs>.<nonce>.<hmac>`.
 * Vérifié au callback : authenticité + fraîcheur + rattachement au praticien
 * (la route contrôle en plus que le praticien appartient à la session).
 */
export function signConnectState(practitionerId: string, secret: string, nowMs: number): string {
  const nonce = randomBytes(16).toString("hex");
  const payload = `v1.${practitionerId}.${nowMs}.${nonce}`;
  const mac = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${mac}`;
}

/** Retourne le practitionerId si le `state` est authentique et frais, sinon null. */
export function verifyConnectState(state: string, secret: string, nowMs: number): string | null {
  const parts = state.split(".");
  if (parts.length !== 5 || parts[0] !== "v1") return null;
  const [, practitionerId, issuedAtRaw, nonce, mac] = parts;
  if (!practitionerId || !issuedAtRaw || !nonce || !mac) return null;
  const issuedAt = Number(issuedAtRaw);
  if (!Number.isInteger(issuedAt) || issuedAt > nowMs || nowMs - issuedAt > CONNECT_STATE_TTL_MS) return null;
  const payload = `v1.${practitionerId}.${issuedAtRaw}.${nonce}`;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const actual = Buffer.from(mac, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  if (actual.length !== wanted.length) return null;
  return timingSafeEqual(actual, wanted) ? practitionerId : null;
}
