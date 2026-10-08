"use client";

import { useState } from "react";

import { t } from "@/lib/i18n";
import { sendJson } from "@/lib/api-client";
import { Button, Checkbox, Field, NumberInput, TextInput } from "@/components/ui";
import RoomCheckboxes from "./RoomCheckboxes";
import RequiresPaymentField from "./RequiresPaymentField";
import type { Room, SessionTypeRow } from "./types";

interface Draft {
  name: string;
  durationMin: number;
  bufferAfterMin: number;
  priceDisplay: string;
  requiresPayment: boolean;
  priceEuros: string;
  requiresValidation: boolean;
  compatibleRoomIds: string[];
}

const EMPTY: Draft = {
  name: "",
  durationMin: 60,
  bufferAfterMin: 10,
  priceDisplay: "",
  requiresPayment: false,
  priceEuros: "",
  requiresValidation: false,
  compatibleRoomIds: [],
};

export default function NewSessionTypeForm({
  practitionerId,
  rooms,
  paymentsReady,
  onCreated,
  onError,
}: {
  practitionerId: string;
  rooms: Room[];
  /** Compte Stripe prêt à encaisser ; sinon le paiement reste désactivé. */
  paymentsReady: boolean;
  onCreated: (row: SessionTypeRow) => void;
  onError: (message: string | null) => void;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const update = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }));

  async function create(event: React.FormEvent) {
    event.preventDefault();
    onError(null);
    const priceCents = draft.requiresPayment ? Math.round(Number(draft.priceEuros) * 100) : null;
    const result = await sendJson<{ id: string }>("/api/session-types", "POST", {
      practitionerId,
      name: draft.name,
      durationMin: draft.durationMin,
      bufferAfterMin: draft.bufferAfterMin,
      priceDisplay: draft.priceDisplay || undefined,
      requiresPayment: draft.requiresPayment,
      priceCents: priceCents ?? undefined,
      requiresValidation: draft.requiresValidation,
      compatibleRoomIds: draft.compatibleRoomIds,
    });
    if (!result.ok) {
      onError(result.error);
      return;
    }
    onCreated({
      id: result.data.id,
      name: draft.name,
      description: null,
      durationMin: draft.durationMin,
      bufferAfterMin: draft.bufferAfterMin,
      priceDisplay: draft.priceDisplay || null,
      active: true,
      requiresPayment: draft.requiresPayment,
      priceCents,
      currency: "eur",
      requiresValidation: draft.requiresValidation,
      compatibleRoomIds: draft.compatibleRoomIds,
    });
    setDraft({ ...EMPTY, durationMin: draft.durationMin, bufferAfterMin: draft.bufferAfterMin });
  }

  return (
    <form onSubmit={create} className="mt-2 rounded-2xl border border-dashed border-line bg-card p-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Field label={t("sessionTypesAdmin.name")}>
          <TextInput value={draft.name} onChange={(event) => update({ name: event.target.value })} required maxLength={80} />
        </Field>
        <Field label={t("sessionTypesAdmin.price")}>
          <TextInput
            value={draft.priceDisplay}
            onChange={(event) => update({ priceDisplay: event.target.value })}
            maxLength={30}
          />
        </Field>
        <Field label={t("sessionTypesAdmin.duration")}>
          <NumberInput
            unit="min"
            value={draft.durationMin}
            min={5}
            max={480}
            onChange={(event) => update({ durationMin: Number(event.target.value) })}
          />
        </Field>
        <Field
          label={t("sessionTypesAdmin.buffer")}
          tooltip={t("sessionTypesAdmin.bufferHint")}
          tooltipAlign="right"
        >
          <NumberInput
            unit="min"
            value={draft.bufferAfterMin}
            min={0}
            max={480}
            onChange={(event) => update({ bufferAfterMin: Number(event.target.value) })}
          />
        </Field>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <RequiresPaymentField
          checked={draft.requiresPayment}
          paymentsReady={paymentsReady}
          onChange={(requiresPayment) => update({ requiresPayment })}
        />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={draft.requiresValidation}
            onChange={(event) => update({ requiresValidation: event.target.checked })}
          />
          {t("sessionTypesAdmin.requiresValidation")}
        </label>
      </div>
      {draft.requiresPayment ? (
        <div className="mt-2 max-w-56">
          <Field label={t("sessionTypesAdmin.priceCents")} hint={t("sessionTypesAdmin.priceCentsHint")}>
            <NumberInput
              unit="€"
              value={draft.priceEuros}
              min={1}
              onChange={(event) => update({ priceEuros: event.target.value })}
              required
            />
          </Field>
        </div>
      ) : null}
      <RoomCheckboxes
        rooms={rooms}
        selected={draft.compatibleRoomIds}
        onChange={(compatibleRoomIds) => update({ compatibleRoomIds })}
      />
      <Button type="submit" size="sm" className="mt-2">
        {t("sessionTypesAdmin.create")}
      </Button>
    </form>
  );
}
