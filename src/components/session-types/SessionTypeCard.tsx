import { t } from "@/lib/i18n";
import { Button, Checkbox, Field, NumberInput, TextInput } from "@/components/ui";
import RoomCheckboxes from "./RoomCheckboxes";
import type { Room, SessionTypeRow } from "./types";

export default function SessionTypeCard({
  row,
  rooms,
  onChange,
  onSave,
  onDelete,
}: {
  row: SessionTypeRow;
  rooms: Room[];
  onChange: (patch: Partial<SessionTypeRow>) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-2xl border border-line bg-card p-4 shadow-soft">
      <div className="grid gap-3 sm:grid-cols-2">
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
        <Field label={t("sessionTypesAdmin.buffer")} hint={t("sessionTypesAdmin.bufferHint")}>
          <NumberInput
            unit="min"
            value={row.bufferAfterMin}
            min={0}
            max={480}
            onChange={(event) => onChange({ bufferAfterMin: Number(event.target.value) })}
          />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={row.active} onChange={(event) => onChange({ active: event.target.checked })} />
          {t("sessionTypesAdmin.active")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={row.requiresPayment}
            onChange={(event) => onChange({ requiresPayment: event.target.checked })}
          />
          {t("sessionTypesAdmin.requiresPayment")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={row.requiresValidation}
            onChange={(event) => onChange({ requiresValidation: event.target.checked })}
          />
          {t("sessionTypesAdmin.requiresValidation")}
        </label>
        <span className="ml-auto flex gap-2">
          <Button size="sm" onClick={onSave}>
            {t("sessionTypesAdmin.save")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete}>
            {t("sessionTypesAdmin.delete")}
          </Button>
        </span>
      </div>
      {row.requiresPayment ? (
        <div className="mt-3 max-w-xs">
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
    </div>
  );
}
