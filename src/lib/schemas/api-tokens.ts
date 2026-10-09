import { z } from "zod";

/**
 * Contrats des clés d'API personnelles (PAT) + de l'API v1.
 * Les routes session (gestion) injectent `requesterUserId`, les routes v1
 * (Bearer) injectent `practitionerId` résolu depuis le token.
 */

// --- Gestion (session, onglet Profil → API) ---

export const createApiTokenSchema = z.object({
  requesterUserId: z.string().min(1),
  /** Nom donné par le praticien (« Calendly », « écran salle d'attente »…). */
  name: z.string().trim().min(1).max(60),
  /** Accès en écriture (créer/annuler des RDV) ; la lecture est toujours incluse. */
  write: z.boolean().default(true),
  /** Expiration optionnelle (ISO) ; null/omise = sans expiration. */
  expiresAt: z.string().datetime().nullish(),
});
export type CreateApiTokenInput = z.infer<typeof createApiTokenSchema>;

export const revokeApiTokenSchema = z.object({
  requesterUserId: z.string().min(1),
  tokenId: z.string().min(1),
});
export type RevokeApiTokenInput = z.infer<typeof revokeApiTokenSchema>;

// --- API v1 (Bearer `cbpat_…`) ---

export const API_TOKEN_PREFIX = "cbpat_";
export const API_SCOPES = ["read", "write"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/** Fenêtre de lecture du planning (défaut : maintenant → +30 j, max 93 j). */
export const apiBookingsQuerySchema = z.object({
  start: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
  status: z.enum(["pending", "confirmed", "cancelled", "completed"]).optional(),
});
export type ApiBookingsQuery = z.infer<typeof apiBookingsQuerySchema>;

/**
 * Création via intégration externe : même sémantique que la saisie manuelle
 * (confirmé direct, email au patient, pas de paiement/validation — l'outil
 * externe est le système de référence), avec la salle auto-assignée quand
 * `roomId` est omise (première salle libre, comme le parcours public).
 */
export const apiCreateBookingSchema = z.object({
  sessionTypeId: z.string().min(1),
  sessionVariantId: z.string().min(1).optional(),
  startAt: z.string().datetime(),
  roomId: z.string().min(1).optional(),
  patientFirstName: z.string().trim().min(1).max(100),
  patientLastName: z.string().trim().min(1).max(100),
  patientEmail: z.string().trim().email().max(254),
  patientPhone: z.string().trim().max(30).optional(),
  notes: z.string().trim().max(500).optional(),
  overrideOff: z.boolean().default(false),
});
export type ApiCreateBookingInput = z.infer<typeof apiCreateBookingSchema>;

export const apiCancelBookingSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type ApiCancelBookingInput = z.infer<typeof apiCancelBookingSchema>;
