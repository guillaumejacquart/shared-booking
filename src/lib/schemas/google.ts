import { z } from "zod";

/** Préférences de push Google Agenda du praticien connecté. */
export const saveGooglePrefsSchema = z.object({
  requesterUserId: z.string().min(1),
  syncEnabled: z.boolean().optional(),
  calendarId: z.string().min(1).max(256).optional(),
  showPatientName: z.boolean().optional(),
});
export type SaveGooglePrefsInput = z.infer<typeof saveGooglePrefsSchema>;
