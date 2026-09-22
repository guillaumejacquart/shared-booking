import { z } from "zod";

import { PALETTES, THEME_MODES } from "@/lib/theme";

/**
 * Contrats du domaine paramétrage (dispos, séances, salles, profil, cabinet).
 * Même principe que `schemas/bookings.ts` : source unique, types dérivés.
 */

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
export const SLUG_RE = /^[a-z0-9-]{2,60}$/;

/**
 * Identité du demandeur uniquement : la route authentifie (qui), le service
 * résout le périmètre (office) et contrôle l'accès (soi-même ou owner).
 * Ni le rôle ni l'office ne transitent jamais depuis le client.
 */
const requesterSchema = z.object({
  requesterUserId: z.string().min(1),
});
export type Requester = z.infer<typeof requesterSchema>;

const scopeSchema = z.object({
  practitionerId: z.string().min(1),
});

const ruleSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startTime: z.string().regex(TIME_RE),
  endTime: z.string().regex(TIME_RE),
  // Pas de salle : la disponibilité hebdo est celle du praticien, la salle
  // est attribuée à la réservation (première salle autorisée libre).
});

export const replaceAvailabilitySchema = scopeSchema
  .merge(requesterSchema)
  .extend({ rules: z.array(ruleSchema).max(50) });
export type ReplaceAvailabilityInput = z.infer<typeof replaceAvailabilitySchema>;

export const saveSessionTypeSchema = scopeSchema.merge(requesterSchema).extend({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullish(),
  durationMin: z.number().int().min(5).max(480),
  bufferAfterMin: z.number().int().min(0).max(480),
  priceDisplay: z.string().trim().max(30).nullish(),
  active: z.boolean().optional(),
  requiresPayment: z.boolean().default(false),
  priceCents: z.number().int().min(1).max(999999).nullish(),
  requiresValidation: z.boolean().default(false),
  /** Salles compatibles (vide = toutes les salles autorisées au praticien). */
  compatibleRoomIds: z.array(z.string().min(1)).max(20).default([]),
});
export type SaveSessionTypeInput = z.infer<typeof saveSessionTypeSchema>;

export const deleteSessionTypeSchema = scopeSchema
  .merge(requesterSchema)
  .extend({ id: z.string().min(1) });
export type DeleteSessionTypeInput = z.infer<typeof deleteSessionTypeSchema>;

export const createExceptionSchema = scopeSchema.merge(requesterSchema).extend({
  date: z
    .string()
    .regex(DATE_RE, "Date invalide (AAAA-MM-JJ)")
    .refine(
      (d) => {
        const [y, m, day] = d.split("-").map(Number);
        const dt = new Date(Date.UTC(y, m - 1, day));
        return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day;
      },
      "Date invalide (AAAA-MM-JJ)",
    ),
  kind: z.enum(["off", "extra"]),
  fullDay: z.boolean(),
  startTime: z.string().regex(TIME_RE).optional(),
  endTime: z.string().regex(TIME_RE).optional(),
  roomId: z.string().min(1).optional(),
  reason: z.string().trim().max(200).optional(),
});
export type CreateExceptionInput = z.infer<typeof createExceptionSchema>;

export const deleteExceptionSchema = scopeSchema
  .merge(requesterSchema)
  .extend({ id: z.string().min(1) });
export type DeleteExceptionInput = z.infer<typeof deleteExceptionSchema>;

export const updateProfileSchema = scopeSchema.merge(requesterSchema).extend({
  displayName: z.string().trim().min(1).max(100),
  slug: z.string().trim().toLowerCase().regex(SLUG_RE).optional(),
  bio: z.string().trim().max(2000).optional(),
  publicContact: z.string().trim().max(200).optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const saveRoomSchema = z.object({
  officeId: z.string().min(1),
  requesterUserId: z.string().min(1),
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(COLOR_RE).default("#4e7a5b"),
  practitionerIds: z.array(z.string().min(1)).default([]),
});
export type SaveRoomInput = z.infer<typeof saveRoomSchema>;

export const deleteRoomSchema = z.object({
  officeId: z.string().min(1),
  requesterUserId: z.string().min(1),
  id: z.string().min(1),
});
export type DeleteRoomInput = z.infer<typeof deleteRoomSchema>;

export const updateOfficeSettingsSchema = z.object({
  officeId: z.string().min(1),
  requesterUserId: z.string().min(1),
  name: z.string().trim().min(1).max(80).optional(),
  address: z.string().trim().max(200).nullable().optional(),
  enablePractitionerPages: z.boolean().optional(),
  enableOfficePage: z.boolean().optional(),
  bookingLeadTimeMin: z.number().int().min(0).max(1440).optional(),
  cancelDeadlineHours: z.number().int().min(0).max(168).optional(),
  reminderHoursBefore: z.number().int().min(0).max(168).optional(),
  defaultBufferAfterMin: z.number().int().min(0).max(480).optional(),
  themePalette: z.enum(PALETTES).optional(),
  themeMode: z.enum(THEME_MODES).optional(),
});
export type UpdateOfficeSettingsInput = z.infer<typeof updateOfficeSettingsSchema>;
