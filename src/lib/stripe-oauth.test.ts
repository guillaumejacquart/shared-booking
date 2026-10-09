import { describe, expect, it } from "vitest";

import {
  buildStandardAuthorizeUrl,
  signConnectState,
  stripeOAuthRedirectUri,
  verifyConnectState,
} from "./stripe-oauth";

const SECRET = "test-state-secret-32-chars-minimum";
const NOW = 1_786_000_000_000;

describe("stripe oauth", () => {
  it("construit l'URL d'autorisation Standard", () => {
    const url = new URL(
      buildStandardAuthorizeUrl({
        clientId: "ca_test_123",
        redirectUri: "https://cabinet.example/api/stripe/connect/callback",
        state: "v1.prac.123.abc.def",
        email: "praticien@example.com",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://connect.stripe.com/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("ca_test_123");
    expect(url.searchParams.get("scope")).toBe("read_write");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://cabinet.example/api/stripe/connect/callback",
    );
    expect(url.searchParams.get("stripe_user[email]")).toBe("praticien@example.com");
  });

  it("redirectUri dérive de l'origine canonique", () => {
    expect(stripeOAuthRedirectUri("https://cabinet.example/")).toBe(
      "https://cabinet.example/api/stripe/connect/callback",
    );
  });

  it("state signé : valide, rattaché au praticien", () => {
    const state = signConnectState("prac-1", SECRET, NOW);
    expect(verifyConnectState(state, SECRET, NOW + 60_000)).toBe("prac-1");
  });

  it("state rejeté : falsifié, expiré, futur ou mauvais secret", () => {
    const state = signConnectState("prac-1", SECRET, NOW);
    expect(verifyConnectState(state.slice(0, -1) + "0", SECRET, NOW)).toBeNull();
    expect(verifyConnectState(state, "wrong-secret", NOW)).toBeNull();
    expect(verifyConnectState(state, SECRET, NOW + 16 * 60_000)).toBeNull();
    expect(verifyConnectState(state, SECRET, NOW - 1)).toBeNull();
    expect(verifyConnectState("nimporte-quoi", SECRET, NOW)).toBeNull();
  });
});
