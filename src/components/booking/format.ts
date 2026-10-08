export interface SessionTypeVariantOpt {
  id: string;
  durationMin: number;
  bufferAfterMin: number;
  priceDisplay: string | null;
  priceCents: number | null;
}

import { formatPlainAmount } from "@/lib/onsite-payments";

export interface SessionTypeOpt {
  id: string;
  name: string;
  description: string | null;
  requiresPayment: boolean;
  currency: string;
  variants: SessionTypeVariantOpt[];
}

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
    return formatPlainAmount(variant.priceDisplay, currency) ?? variant.priceDisplay;
  }
  if (requiresPayment && variant.priceCents) {
    return formatAmount(variant.priceCents / 100, currency);
  }
  return null;
}
