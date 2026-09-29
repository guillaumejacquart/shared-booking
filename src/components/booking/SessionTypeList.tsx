import { t } from "@/lib/i18n";
import { Badge, OptionCard } from "@/components/ui";
import { displayPrice, type SessionTypeOpt } from "./format";

export default function SessionTypeList({
  sessionTypes,
  selectedId,
  onSelect,
}: {
  sessionTypes: SessionTypeOpt[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="grid gap-2">
      {sessionTypes.map((sessionType) => {
        const price = displayPrice(sessionType);
        return (
          <OptionCard
            key={sessionType.id}
            selected={sessionType.id === selectedId}
            onClick={() => onSelect(sessionType.id)}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{sessionType.name}</span>
              <span className="shrink-0 text-sm text-mist">
                {t("booking.minutes", { min: sessionType.durationMin })}
                {price ? ` · ${price}` : ""}
              </span>
            </div>
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
      })}
    </div>
  );
}
