import { z } from "zod";

/** Contrats du domaine équipe (invitations, création de cabinet). */

export const officeSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]{3,60}$/, "Identifiant invalide (lettres, chiffres, tirets)");

const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const createInviteSchema = z.object({
  officeId: z.string().min(1),
  email: emailSchema,
  role: z.enum(["owner", "practitioner"]),
  requesterUserId: z.string().min(1),
  origin: z.string().url(),
});
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(1),
  userId: z.string().min(1),
  userEmail: emailSchema,
  userName: z.string().trim().min(1).max(100),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const createOfficeSchema = z.object({
  userId: z.string().min(1),
  userName: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(80),
  slug: officeSlugSchema,
  address: z.string().trim().max(200).optional(),
});
export type CreateOfficeInput = z.infer<typeof createOfficeSchema>;

export const removeMemberSchema = z.object({
  officeId: z.string().min(1),
  memberId: z.string().min(1),
  requesterUserId: z.string().min(1),
});
export type RemoveMemberInput = z.infer<typeof removeMemberSchema>;
