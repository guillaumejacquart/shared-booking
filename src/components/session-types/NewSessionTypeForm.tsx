"use client";

import { useState } from "react";

import { t } from "@/lib/i18n";
import { sendJson } from "@/lib/api-client";
import { Button, Checkbox, Field, TextInput } from "@/components/ui";
import RoomCheckboxes from "./RoomCheckboxes";
import RequiresPaymentField from "./RequiresPaymentField";
import VariantsEditor, { isNewVariantKey, newVariantKey } from "./VariantsEditor";
import type { PublicVariant } from "@/app/api/session-types/variants";
import type { Room, SessionTypeRow, SessionTypeVariantRow } from "./types";

interface Draft {
  name: string;
  description: string;
  variants: SessionTypeVariantRow[];
  requiresPayment: boolean;
  requiresValidation: boolean;
  compatibleRoomIds: string[];
}

function emptyDraft(requiresValidation: boolean): Draft {
  return {
    name: "",
    description: "",
    variants: [
      { id: newVariantKey(), durationMin: 60, bufferAfterMin: 10, priceDisplay: null, priceCents: null },
    ],
    requiresPayment: false,
    requiresValidation,
    compatibleRoomIds: [],
  };
}

export default function NewSessionTypeForm({
  practitionerId,
  rooms,
  paymentsReady,
  defaultRequiresValidation = false,
  onCreated,
  onError,
}: {
  practitionerId: string;
  rooms: Room[];
  /** Compte Stripe prêt à encaisser ; sinon le paiement reste désactivé. */
  paymentsReady: boolean;
  /** Défaut praticien : pré-remplit la case validation (modifiable par séance). */
  defaultRequiresValidation?: boolean;
  onCreated: (row: SessionTypeRow) => void;
  onError: (message: string | null) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(defaultRequiresValidation));
  const [creating, setCreating] = useState(false);
  const update = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }));

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (creating) return;
    onError(null);
    setCreating(true);
    try {
    const result = await sendJson<{ id: string; variants: PublicVariant[] }>(
      "/api/session-types",
      "POST",
      {
        practitionerId,
        name: draft.name,
        description: draft.description || undefined,
        requiresPayment: draft.requiresPayment,
        requiresValidation: draft.requiresValidation,
        compatibleRoomIds: draft.compatibleRoomIds,
        variants: draft.variants.map((variant) => ({
          // Les ids temporaires partent sans id : le service crée tout.
          ...(isNewVariantKey(variant.id) ? {} : { id: variant.id }),
          durationMin: variant.durationMin,
          bufferAfterMin: variant.bufferAfterMin,
          priceDisplay: variant.priceDisplay || undefined,
          priceCents: variant.priceCents ?? undefined,
        })),
      },
    );
    if (!result.ok) {
      onError(result.error);
      return;
    }
    onCreated({
      id: result.data.id,
      name: draft.name,
      description: draft.description || null,
      active: true,
      requiresPayment: draft.requiresPayment,
      currency: "eur",
      requiresValidation: draft.requiresValidation,
      variants: result.data.variants,
      compatibleRoomIds: draft.compatibleRoomIds,
    });
    const keepValidation = defaultRequiresValidation;
    setDraft({ ...emptyDraft(keepValidation), compatibleRoomIds: draft.compatibleRoomIds });
    } finally {
      setCreating(false);
    }
  }

  return (
    <form onSubmit={create} className="mt-2 rounded-2xl border border-dashed border-line bg-card p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={t("sessionTypesAdmin.name")}>
          <TextInput value={draft.name} onChange={(event) => update({ name: event.target.value })} required maxLength={80} />
        </Field>
        <Field label={t("sessionTypesAdmin.description")}>
          <TextInput
            value={draft.description}
            onChange={(event) => update({ description: event.target.value })}
            maxLength={500}
          />
        </Field>
      </div>
      <VariantsEditor
        variants={draft.variants}
        showPriceCents={draft.requiresPayment}
        onChange={(variants) => update({ variants })}
      />
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
      <RoomCheckboxes
        rooms={rooms}
        selected={draft.compatibleRoomIds}
        onChange={(compatibleRoomIds) => update({ compatibleRoomIds })}
      />
      <Button type="submit" size="sm" className="mt-2" disabled={creating}>
        {creating ? t("sessionTypesAdmin.creating") : t("sessionTypesAdmin.create")}
      </Button>
    </form>
  );
}
