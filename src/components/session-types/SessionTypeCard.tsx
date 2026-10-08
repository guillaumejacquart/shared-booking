import { t } from "@/lib/i18n";
import { Button, Checkbox, Field, NumberInput, TextInput } from "@/components/ui";
import RoomCheckboxes from "./RoomCheckboxes";
import RequiresPaymentField from "./RequiresPaymentField";
import type { Room, SessionTypeRow } from "./types";

export default function SessionTypeCard({
  row,
  rooms,
  paymentsReady,
  onChange,
  onSave,
  onDelete,
}: {
  row: SessionTypeRow;
  rooms: Room[];
  /** Compte Stripe prêt à encaisser ; sinon on ne peut (ré)activer le paiement. */
  paymentsReady: boolean;
  onChange: (patch: Partial<SessionTypeRow>) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-2xl border border-line bg-card p-3 shadow-soft">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Field label={t("sessionTypesAdmin.name")}>
          <TextInput value={row.name} onChange={(event) => onChange({ name: event.target.value })} maxLength={80} />
        </Field>
        <Field label={t("sessionTypesAdmin.price")}>
          <TextInput
            value={row.priceDisplay ?? ""}
            onChange={(event) => onChange({ priceDisplay: event.target.value })}
            maxLength={30}
          />
        </Field>
        <Field label={t("sessionTypesAdmin.duration")}>
          <NumberInput
            unit="min"
            value={row.durationMin}
            min={5}
            max={480}
            onChange={(event) => onChange({ durationMin: Number(event.target.value) })}
          />
        </Field>
        <Field
          label={t("sessionTypesAdmin.buffer")}
          tooltip={t("sessionTypesAdmin.bufferHint")}
          tooltipAlign="right"
        >
          <NumberInput
            unit="min"
            value={row.bufferAfterMin}
            min={0}
            max={480}
            onChange={(event) => onChange({ bufferAfterMin: Number(event.target.value) })}
          />
        </Field>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={row.active} onChange={(event) => onChange({ active: event.target.checked })} />
          {t("sessionTypesAdmin.active")}
        </label>
        <RequiresPaymentField
          checked={row.requiresPayment}
          paymentsReady={paymentsReady}
          onChange={(requiresPayment) => onChange({ requiresPayment })}
        />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={row.requiresValidation}
            onChange={(event) => onChange({ requiresValidation: event.target.checked })}
          />
          {t("sessionTypesAdmin.requiresValidation")}
        </label>
      </div>
      {row.requiresPayment ? (
        <div className="mt-2 max-w-56">
          <Field label={t("sessionTypesAdmin.priceCents")} hint={t("sessionTypesAdmin.priceCentsHint")}>
            <NumberInput
              unit="€"
              value={row.priceCents != null ? row.priceCents / 100 : ""}
              min={1}
              onChange={(event) =>
                onChange({
                  priceCents: event.target.value === "" ? null : Math.round(Number(event.target.value) * 100),
                })
              }
            />
          </Field>
        </div>
      ) : null}
      <RoomCheckboxes
        rooms={rooms}
        selected={row.compatibleRoomIds}
        onChange={(compatibleRoomIds) => onChange({ compatibleRoomIds })}
      />
      <div className="mt-2 flex justify-start gap-1.5">
        <Button size="sm" onClick={onSave}>
          {t("sessionTypesAdmin.save")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete}>
          {t("sessionTypesAdmin.delete")}
        </Button>
      </div>
    </div>
  );
}
