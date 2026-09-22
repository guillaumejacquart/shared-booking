import * as preferencesDal from "@/dal/preferences";
import {
  savePreferencesSchema,
  type SavePreferencesInput,
} from "@/lib/schemas/preferences";

export { savePreferencesSchema, type SavePreferencesInput };

/**
 * Préférences d'apparence personnelles : validées (palettes/modes connus),
 * persistées en base, reflétées en cookies par la route API.
 */

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
