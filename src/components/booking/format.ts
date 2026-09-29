export interface SessionTypeOpt {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  priceDisplay: string | null;
  requiresPayment: boolean;
  priceCents: number | null;
  currency: string;
}

/** Prix affiché : texte libre ou montant Stripe formaté. */
export function displayPrice(sessionType: SessionTypeOpt): string | null {
  if (sessionType.priceDisplay) return sessionType.priceDisplay;
  if (sessionType.requiresPayment && sessionType.priceCents) {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: sessionType.currency }).format(
      sessionType.priceCents / 100,
    );
  }
  return null;
}
