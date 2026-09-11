/**
 * Couleurs stables par praticien (calendrier partagé). Palette lisible
 * en clair comme en sombre, texte blanc dessus.
 */
const PALETTE = [
  "#4f46e5", // indigo
  "#0d9488", // teal
  "#e11d48", // rose
  "#b45309", // amber
  "#0284c7", // sky
  "#7c3aed", // violet
  "#059669", // emerald
];

/** Couleur d'un praticien selon sa position dans une liste triée par id. */
export function practitionerColor(sortedIds: string[], practitionerId: string): string {
  const idx = sortedIds.indexOf(practitionerId);
  return PALETTE[(idx === -1 ? 0 : idx) % PALETTE.length];
}
