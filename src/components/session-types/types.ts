export interface SessionTypeRow {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  bufferAfterMin: number;
  priceDisplay: string | null;
  active: boolean;
  requiresPayment: boolean;
  priceCents: number | null;
  currency: string;
  requiresValidation: boolean;
  /** Salles compatibles (vide = toutes les salles du praticien). */
  compatibleRoomIds: string[];
}

export interface Room {
  id: string;
  name: string;
}
