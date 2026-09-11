/**
 * Prédicats de dates (calculs impurs isolés hors des composants,
 * cf. règle eslint react-hooks/purity).
 */

/** Vrai si `d` est dans le futur (comparé à `now`, injecté pour les tests). */
export function isFuture(d: Date, now: Date = new Date()): boolean {
  return d.getTime() > now.getTime();
}
