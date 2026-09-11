"use client";

/**
 * Les trois blocs de la page Disponibilités (règles hebdo, exceptions,
 * calendrier) ont chacun leur copie des données : après chaque mutation,
 * on émet cet événement pour que le calendrier recharge depuis l'API
 * (source de vérité) au lieu de garder un état périmé.
 */
export const AVAILABILITIES_CHANGED = "availabilities:changed";

export function notifyAvailabilitiesChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AVAILABILITIES_CHANGED));
  }
}
