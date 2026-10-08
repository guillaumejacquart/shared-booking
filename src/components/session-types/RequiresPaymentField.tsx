"use client";

import { t } from "@/lib/i18n";
import { Checkbox, InfoTooltip } from "@/components/ui";

/**
 * Case « Paiement en ligne requis » : désactivée tant que le compte Stripe
 * du praticien n'est pas prêt à encaisser, avec une infobulle (icône ⓘ)
 * expliquant comment l'activer (Profil → Paiements). Une séance déjà
 * payante reste décochable (compte Stripe délié après coup).
 */
export default function RequiresPaymentField({
  checked,
  paymentsReady,
  onChange,
}: {
  checked: boolean;
  /** Compte Stripe du praticien prêt à encaisser (`charges_enabled`). */
  paymentsReady: boolean;
  onChange: (checked: boolean) => void;
}) {
  const hint = t("sessionTypesAdmin.requiresPaymentLockedHint");
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <label className="flex items-center gap-2">
        <Checkbox
          checked={checked}
          disabled={!paymentsReady && !checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        {t("sessionTypesAdmin.requiresPayment")}
      </label>
      {!paymentsReady ? <InfoTooltip text={hint} /> : null}
    </span>
  );
}
