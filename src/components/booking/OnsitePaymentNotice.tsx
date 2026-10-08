import { t } from "@/lib/i18n";

export interface OnsitePaymentNoticeInfo {
  price: string;
  methods: string | null;
  note: string | null;
}

/**
 * Encadré « à régler sur place » : montant en évidence, moyens acceptés,
 * précision du praticien. Fond neutre : c'est une info paiement, pas un
 * succès — le vert reste réservé à la pastille de confirmation.
 */
export default function OnsitePaymentNotice({ info }: { info: OnsitePaymentNoticeInfo }) {
  return (
    <div className="rounded-2xl border border-line bg-wash p-4 text-ink shadow-soft">
      <p className="text-base font-semibold">{t("booking.payOnSiteRecap", { price: info.price })}</p>
      {info.methods ? (
        <p className="mt-1 text-sm">{t("booking.payOnSiteMethods", { methods: info.methods })}</p>
      ) : null}
      {info.note ? <p className="mt-1 text-sm text-mist">{info.note}</p> : null}
    </div>
  );
}
