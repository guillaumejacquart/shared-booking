export interface SessionTypeVariantOpt {
  id: string;
  durationMin: number;
  bufferAfterMin: number;
  priceDisplay: string | null;
  priceCents: number | null;
}

export interface SessionTypeOpt {
  id: string;
  name: string;
  description: string | null;
  requiresPayment: boolean;
  currency: string;
  variants: SessionTypeVariantOpt[];
}

/** Montant nu (« 60 », « 59,90 », « 1 200 ») : espaces ignorés, 2 décimales max. */
const PLAIN_AMOUNT_RE = /^[0-9]+([.,][0-9]{1,2})?$/;

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(amount);
}

/**
 * Prix affiché d'une déclinaison : texte libre tel quel (« sur devis »,
 * « 60 € », « à partir de 50 € »), sauf montant nu (« 60 ») qui est formaté
 * avec la devise — sinon on ne sait pas que c'est un prix. Sinon montant
 * Stripe formaté, sinon rien.
 */
export function displayPrice(
  variant: SessionTypeVariantOpt,
  currency: string,
  requiresPayment: boolean,
): string | null {
  if (variant.priceDisplay) {
    const compact = variant.priceDisplay.trim().replace(/\s/g, "");
    if (PLAIN_AMOUNT_RE.test(compact)) {
      const amount = Number(compact.replace(",", "."));
      if (Number.isFinite(amount)) return formatAmount(amount, currency);
    }
    return variant.priceDisplay;
  }
  if (requiresPayment && variant.priceCents) {
    return formatAmount(variant.priceCents / 100, currency);
  }
  return null;
}
