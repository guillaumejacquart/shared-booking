import * as schema from "@/db/schema";
import type { Db } from "@/dal/types";

/**
 * Fixture types de séances pour les tests : insère le groupe + ses
 * déclinaisons (variantes durée/prix) en un appel.
 */
export interface VariantSeed {
  id: string;
  durationMin: number;
  bufferAfterMin?: number;
  priceDisplay?: string | null;
  priceCents?: number | null;
}

export async function seedSessionType(
  db: Db,
  data: {
    id: string;
    practitionerId: string;
    name: string;
    description?: string | null;
    requiresPayment?: boolean;
    currency?: string;
    requiresValidation?: boolean;
    active?: boolean;
    variants: VariantSeed[];
  },
): Promise<string> {
  await db.insert(schema.sessionType).values({
    id: data.id,
    practitionerId: data.practitionerId,
    name: data.name,
    description: data.description ?? null,
    requiresPayment: data.requiresPayment ?? false,
    currency: data.currency ?? "eur",
    requiresValidation: data.requiresValidation ?? false,
    active: data.active ?? true,
  });
  for (const [index, variant] of data.variants.entries()) {
    await db.insert(schema.sessionTypeVariant).values({
      id: variant.id,
      sessionTypeId: data.id,
      durationMin: variant.durationMin,
      bufferAfterMin: variant.bufferAfterMin ?? 0,
      priceDisplay: variant.priceDisplay ?? null,
      priceCents: variant.priceCents ?? null,
      sortOrder: index,
    });
  }
  return data.id;
}

/** Raccourci : une séance à variante unique (cas historique). */
export async function seedSingleVariant(
  db: Db,
  data: {
    id: string;
    practitionerId: string;
    name: string;
    durationMin: number;
    bufferAfterMin?: number;
    priceDisplay?: string | null;
    priceCents?: number | null;
    requiresPayment?: boolean;
    requiresValidation?: boolean;
  },
): Promise<string> {
  return seedSessionType(db, {
    ...data,
    variants: [
      {
        id: `${data.id}-v1`,
        durationMin: data.durationMin,
        bufferAfterMin: data.bufferAfterMin,
        priceDisplay: data.priceDisplay,
        priceCents: data.priceCents,
      },
    ],
  });
}
