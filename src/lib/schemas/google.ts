import { z } from "zod";

/** Préférences Google Agenda du praticien connecté (push + blocage). */
export const saveGooglePrefsSchema = z.object({
  requesterUserId: z.string().min(1),
  syncEnabled: z.boolean().optional(),
  calendarId: z.string().min(1).max(256).optional(),
  showPatientName: z.boolean().optional(),
  /** Inbound : bloque les créneaux occupés dans les agendas choisis. */
  blockEnabled: z.boolean().optional(),
  blockCalendarIds: z.array(z.string().min(1).max(256)).max(20).optional(),
  /** Inbound : bloque aussi les événements « journée entière ». */
  blockAllDay: z.boolean().optional(),
});
export type SaveGooglePrefsInput = z.infer<typeof saveGooglePrefsSchema>;
