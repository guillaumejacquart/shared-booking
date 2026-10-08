import Link from "next/link";

import { t } from "@/lib/i18n";

/**
 * Alerte "pas de salle" : sans salle attribuable, le moteur de créneaux ne
 * produit rien et la page de réservation reste vide (sans erreur visible).
 * - `missing` : aucune salle au cabinet (bandeau global du dashboard).
 * - `unassigned` : des salles existent mais aucune n'est attribuée au
 *   praticien connecté (rappel contextuel calendrier / disponibilités).
 * Seul le owner peut configurer les salles : les autres rôles voient le
 * constat sans appel à l'action (l'onglet salles leur est interdit).
 */
export default function RoomsMissingAlert({
  variant,
  isOwner,
}: {
  variant: "missing" | "unassigned";
  isOwner: boolean;
}) {
  return (
    <p role="alert" className="rounded-2xl bg-warn-bg p-4 text-sm text-warn">
      {variant === "missing" ? t("rooms.missingAlert") : t("rooms.unassignedAlert")}{" "}
      {isOwner ? (
        <Link href="/dashboard/parametres?tab=rooms" className="font-semibold underline">
          {t("rooms.missingCta")}
        </Link>
      ) : null}
    </p>
  );
}
