import { z } from "zod";

import * as preferencesDal from "@/dal/preferences";
import { PALETTES, THEME_MODES } from "@/lib/theme";

/**
 * Préférences d'apparence personnelles : validées (palettes/modes connus),
 * persistées en base, reflétées en cookies par la route API.
 */

export const savePreferencesSchema = z.object({
  requesterUserId: z.string().min(1),
  palette: z.enum(PALETTES),
  mode: z.enum(THEME_MODES),
});
export type SavePreferencesInput = z.infer<typeof savePreferencesSchema>;

export async function saveUserPreferences(
  input: SavePreferencesInput,
): Promise<void> {
  await preferencesDal.savePreferences(input.requesterUserId, {
    palette: input.palette,
    mode: input.mode,
  });
}

export async function getUserPreferences(userId: string) {
  return preferencesDal.getPreferences(userId);
}
