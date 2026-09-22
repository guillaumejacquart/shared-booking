/**
 * Couleurs stables par praticien (calendrier partagé). Tons profonds et
 * sourds, harmonisés avec les palettes bien-être ; texte blanc dessus
 * (contraste ≥ 4,5:1 vérifié).
 */
const PALETTE = [
  "#4e7a5b", // sauge
  "#3f6e85", // brume
  "#6a5fa0", // lavande
  "#96603a", // bois
  "#9e5f74", // rose poudré
  "#4f7d6a", // eucalyptus
  "#7a5c8f", // prune
];

/** Couleur d'un praticien selon sa position dans une liste triée par id. */
export function practitionerColor(sortedIds: string[], practitionerId: string): string {
  const idx = sortedIds.indexOf(practitionerId);
  return PALETTE[(idx === -1 ? 0 : idx) % PALETTE.length];
}
