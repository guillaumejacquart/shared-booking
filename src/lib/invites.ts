/**
 * Statut d'une invitation (calcul impur isolé hors des composants,
 * cf. règle eslint react-hooks/purity).
 */
export function inviteStatus(
  inv: { expiresAt: Date; acceptedAt: Date | null },
  now: Date = new Date(),
): "valid" | "expired" | "accepted" {
  if (inv.acceptedAt) return "accepted";
  if (inv.expiresAt.getTime() < now.getTime()) return "expired";
  return "valid";
}
