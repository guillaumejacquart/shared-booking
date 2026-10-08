import type { SessionTypeVariant } from "@/dal/types";

/** Déclinaisons exposées au client après sauvegarde (ids serveurs). */
export function publicVariants(variants: SessionTypeVariant[]) {
  return variants.map((variant) => ({
    id: variant.id,
    durationMin: variant.durationMin,
    bufferAfterMin: variant.bufferAfterMin,
    priceDisplay: variant.priceDisplay,
    priceCents: variant.priceCents,
  }));
}

export type PublicVariant = ReturnType<typeof publicVariants>[number];
