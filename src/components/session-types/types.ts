export interface SessionTypeVariantRow {
  /** Id serveur ; absent/tmp = nouvelle déclinaison (créée à la sauvegarde). */
  id: string;
  durationMin: number;
  bufferAfterMin: number;
  priceDisplay: string | null;
  priceCents: number | null;
}

export interface SessionTypeRow {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  requiresPayment: boolean;
  currency: string;
  requiresValidation: boolean;
  /** Déclinaisons durée/prix (1 par défaut, durées distinctes). */
  variants: SessionTypeVariantRow[];
  /** Salles compatibles (vide = toutes les salles du praticien). */
  compatibleRoomIds: string[];
}

export interface Room {
  id: string;
  name: string;
}
