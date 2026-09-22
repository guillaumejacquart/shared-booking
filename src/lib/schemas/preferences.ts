import { z } from "zod";

import { PALETTES, THEME_MODES } from "@/lib/theme";

/** Schéma de sauvegarde des préférences d'apparence personnelles. */
export const savePreferencesSchema = z.object({
  requesterUserId: z.string().min(1),
  palette: z.enum(PALETTES),
  mode: z.enum(THEME_MODES),
});
export type SavePreferencesInput = z.infer<typeof savePreferencesSchema>;
