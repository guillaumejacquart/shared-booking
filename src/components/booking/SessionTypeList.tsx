import { t } from "@/lib/i18n";
import { Badge, OptionCard } from "@/components/ui";
import { displayPrice, type SessionTypeOpt } from "./format";

export interface SessionSelection {
  typeId: string;
  variantId: string;
}

function VariantLabel({
  name,
  durationMin,
  price,
}: {
  name: string;
  durationMin: number;
  price: string | null;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="font-medium">{name}</span>
      <span className="shrink-0 text-sm text-mist">
        {t("booking.minutes", { min: durationMin })}
        {price ? ` · ${price}` : ""}
      </span>
    </div>
  );
}

export default function SessionTypeList({
  sessionTypes,
  selected,
  onSelect,
}: {
  sessionTypes: SessionTypeOpt[];
  selected: SessionSelection | null;
  onSelect: (selection: SessionSelection) => void;
}) {
  return (
    <div className="grid gap-2">
      {sessionTypes.map((sessionType) => {
        const single = sessionType.variants.length <= 1;
        const variant = sessionType.variants[0];
        // Déclinaison unique : comportement historique (une carte = une durée).
        if (single && variant) {
          const active = selected?.typeId === sessionType.id;
          return (
            <OptionCard
              key={sessionType.id}
              selected={active}
              onClick={() => onSelect({ typeId: sessionType.id, variantId: variant.id })}
            >
              <VariantLabel
                name={sessionType.name}
                durationMin={variant.durationMin}
                price={displayPrice(variant, sessionType.currency, sessionType.requiresPayment)}
              />
              {sessionType.requiresPayment ? (
                <div className="mt-1">
                  <Badge tone="blue">{t("booking.payOnline")}</Badge>
                </div>
              ) : null}
              {sessionType.description ? (
                <p className="mt-1 text-sm text-mist">{sessionType.description}</p>
              ) : null}
            </OptionCard>
          );
        }
        // Plusieurs déclinaisons : la séance regroupe ses durées (radio).
        return (
          <div
            key={sessionType.id}
            className="rounded-2xl border border-line bg-card p-3 shadow-soft"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{sessionType.name}</span>
              {sessionType.requiresPayment ? <Badge tone="blue">{t("booking.payOnline")}</Badge> : null}
            </div>
            {sessionType.description ? (
              <p className="mt-1 text-sm text-mist">{sessionType.description}</p>
            ) : null}
            <div className="mt-2 grid gap-2" role="radiogroup" aria-label={sessionType.name}>
              {sessionType.variants.map((option) => {
                const active =
                  selected?.typeId === sessionType.id && selected?.variantId === option.id;
                return (
                  <OptionCard
                    key={option.id}
                    selected={active}
                    onClick={() => onSelect({ typeId: sessionType.id, variantId: option.id })}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span>{t("booking.minutes", { min: option.durationMin })}</span>
                      <span className="shrink-0 text-sm text-mist">
                        {displayPrice(option, sessionType.currency, sessionType.requiresPayment) ?? ""}
                      </span>
                    </div>
                  </OptionCard>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
