import { t } from "@/lib/i18n";

export interface OnsitePaymentNoticeInfo {
  price: string;
  methods: string | null;
  note: string | null;
}

/**
 * Encadré « à régler sur place » : montant en évidence, moyens acceptés,
 * précision du praticien. Teinte verte assortie au badge : dans le parcours
 * de réservation elle se lit comme une info paiement, pas comme un succès.
 */
export default function OnsitePaymentNotice({ info }: { info: OnsitePaymentNoticeInfo }) {
  return (
    <div className="rounded-2xl border bg-ok-bg p-4 text-ok shadow-soft">
      <p className="text-base font-semibold">{t("booking.payOnSiteRecap", { price: info.price })}</p>
      {info.methods ? (
        <p className="mt-1 text-sm">{t("booking.payOnSiteMethods", { methods: info.methods })}</p>
      ) : null}
      {info.note ? <p className="mt-1 text-sm">{info.note}</p> : null}
    </div>
  );
}
