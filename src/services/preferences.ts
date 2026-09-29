import * as preferencesDal from "@/dal/preferences";
import type { SavePreferencesInput } from "@/lib/schemas/preferences";

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

export interface PreferencesService {
  save: typeof saveUserPreferences;
  get: typeof getUserPreferences;
}

export function createPreferencesService(): PreferencesService {
  return { save: saveUserPreferences, get: getUserPreferences };
}
