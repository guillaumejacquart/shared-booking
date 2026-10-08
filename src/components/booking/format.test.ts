import { describe, expect, it } from "vitest";

import { displayPrice, type SessionTypeVariantOpt } from "./format";

function variant(priceDisplay: string | null, priceCents: number | null = null): SessionTypeVariantOpt {
  return { id: "v1", durationMin: 60, bufferAfterMin: 0, priceDisplay, priceCents };
}

const eur = (amount: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "eur" }).format(amount);

describe("displayPrice", () => {
  it("formate un montant nu avec la devise", () => {
    expect(displayPrice(variant("60"), "eur", false)).toBe(eur(60));
    expect(displayPrice(variant(" 59,90 "), "eur", false)).toBe(eur(59.9));
    expect(displayPrice(variant("1 200"), "eur", false)).toBe(eur(1200));
  });

  it("laisse le texte personnalisé tel quel", () => {
    expect(displayPrice(variant("60 €"), "eur", false)).toBe("60 €");
    expect(displayPrice(variant("sur devis"), "eur", false)).toBe("sur devis");
    expect(displayPrice(variant("à partir de 50 €"), "eur", false)).toBe("à partir de 50 €");
  });

  it("formate le montant Stripe sinon, rien si gratuit sans texte", () => {
    expect(displayPrice(variant(null, 6000), "eur", true)).toBe(eur(60));
    expect(displayPrice(variant(null, null), "eur", false)).toBeNull();
    expect(displayPrice(variant(null, 6000), "eur", false)).toBeNull();
  });
});
