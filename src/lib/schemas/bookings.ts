import { z } from "zod";

/**
 * Contrats du domaine réservation — source unique de vérité.
 * Les routes parsent la requête avec ces schémas (400 détaillées via
 * `toResponse`), les services les réutilisent (même objet) puis appliquent
 * les règles métier. Les types TS sont dérivés (`z.infer`), jamais réécrits.
 */

export const MAX_DAYS = 56;
const DEFAULT_DAYS = 14;

export const slotsQuerySchema = z.object({
  practitionerSlug: z.string().min(1),
  sessionTypeId: z.string().min(1),
  /** Déclinaison visée ; défaut = première variante (ordre d'affichage). */
  sessionVariantId: z.string().min(1).optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.coerce.number().int().min(1).max(MAX_DAYS).default(DEFAULT_DAYS),
});
export type SlotsInput = z.infer<typeof slotsQuerySchema>;

const nameSchema = z.string().trim().min(1).max(100);
const emailSchema = z.string().trim().email().max(254);

export const createBookingSchema = z.object({
  practitionerSlug: z.string().min(1),
  sessionTypeId: z.string().min(1),
  /** Déclinaison réservée ; défaut = première variante (ordre d'affichage). */
  sessionVariantId: z.string().min(1).optional(),
  startAt: z.string().datetime(),
  patientFirstName: nameSchema,
  patientLastName: nameSchema,
  patientEmail: emailSchema,
  patientPhone: z.string().trim().max(30).optional(),
  notes: z.string().trim().max(500).optional(),
  consent: z.literal(true, {
    message: "Le consentement est requis pour réserver",
  }),
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const bookingResultSchema = z.object({
  id: z.string(),
  status: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  cancelToken: z.string(),
  rescheduleToken: z.string(),
  requiresPayment: z.boolean(),
  checkoutUrl: z.string().optional(),
});
export type BookingResult = z.infer<typeof bookingResultSchema>;

export const cancelBookingSchema = z.object({
  token: z.string().min(1),
  by: z.enum(["patient", "practitioner"]),
  reason: z.string().trim().max(500).optional(),
});
export type CancelInput = z.infer<typeof cancelBookingSchema>;

export const rescheduleBookingSchema = z.object({
  token: z.string().min(1),
  newStartAt: z.string().datetime(),
});
export type RescheduleInput = z.infer<typeof rescheduleBookingSchema>;

export const validateBookingSchema = z.object({
  bookingId: z.string().min(1),
  requesterUserId: z.string().min(1),
  accept: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});
export type ValidateInput = z.infer<typeof validateBookingSchema>;

export const mutationResultSchema = z.object({
  id: z.string(),
  status: z.string(),
});
export type MutationResult = z.infer<typeof mutationResultSchema>;

export const applyPaymentSchema = z.object({
  stripeSessionId: z.string().min(1),
  paymentIntentId: z.string().nullable(),
});
export type ApplyPaymentInput = z.infer<typeof applyPaymentSchema>;

/**
 * Réservation manuelle (saisie praticien depuis le dashboard).
 * Pas de `consent` (pas de parcours patient), pas de `practitionerSlug`
 * (le praticien est déduit de `requesterUserId`, pour soi uniquement) ;
 * l'email patient reste obligatoire (confirmation, rappels, annulation).
 * `overrideOff` ne force que les congés, jamais un vrai chevauchement.
 */
export const manualBookingSchema = z.object({
  requesterUserId: z.string().min(1),
  sessionTypeId: z.string().min(1),
  /** Déclinaison réservée ; défaut = première variante (ordre d'affichage). */
  sessionVariantId: z.string().min(1).optional(),
  startAt: z.string().datetime(),
  roomId: z.string().min(1),
  patientFirstName: nameSchema,
  patientLastName: nameSchema,
  patientEmail: emailSchema,
  patientPhone: z.string().trim().max(30).optional(),
  notes: z.string().trim().max(500).optional(),
  overrideOff: z.boolean().default(false),
});
export type ManualBookingInput = z.infer<typeof manualBookingSchema>;

/** Contrôle live des salles pour le formulaire manuel. */
export const roomAvailabilityQuerySchema = z.object({
  requesterUserId: z.string().min(1),
  sessionTypeId: z.string().min(1),
  sessionVariantId: z.string().min(1).optional(),
  startAt: z.string().datetime(),
});
export type RoomAvailabilityInput = z.infer<typeof roomAvailabilityQuerySchema>;
