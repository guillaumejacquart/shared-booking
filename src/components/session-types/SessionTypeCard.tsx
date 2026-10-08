"use client";

import { useEffect, useRef, useState } from "react";

import { t } from "@/lib/i18n";
import { Button, Checkbox, Field, FormMessage, TextInput } from "@/components/ui";
import RoomCheckboxes from "./RoomCheckboxes";
import RequiresPaymentField from "./RequiresPaymentField";
import VariantsEditor from "./VariantsEditor";
import type { Room, SessionTypeRow } from "./types";

export default function SessionTypeCard({
  row,
  rooms,
  paymentsReady,
  bare = false,
  onChange,
  onSave,
  onDelete,
}: {
  row: SessionTypeRow;
  rooms: Room[];
  /** Compte Stripe prêt à encaisser ; sinon on ne peut (ré)activer le paiement. */
  paymentsReady: boolean;
  /** Rendu nu (sans carte externe) pour l'affichage en modale. */
  bare?: boolean;
  onChange: (patch: Partial<SessionTypeRow>) => void;
  /** Rejette en cas d'échec (la carte affiche l'erreur sous ses boutons). */
  onSave: () => Promise<void>;
  onDelete: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  function clearFeedback() {
    if (savedTimer.current) clearTimeout(savedTimer.current);
    setStatus("idle");
    setSaveError(null);
  }

  function handleChange(patch: Partial<SessionTypeRow>) {
    // Toute retouche efface le retour de la sauvegarde précédente.
    if (status !== "idle" || saveError) clearFeedback();
    onChange(patch);
  }

  async function handleSave() {
    if (status === "saving") return;
    if (savedTimer.current) clearTimeout(savedTimer.current);
    setSaveError(null);
    setStatus("saving");
    try {
      await onSave();
      setStatus("saved");
      savedTimer.current = setTimeout(() => setStatus("idle"), 3000);
    } catch (error) {
      setStatus("idle");
      setSaveError(error instanceof Error ? error.message : t("booking.errorGeneric"));
    }
  }

  return (
    <div className={bare ? "" : "rounded-2xl border border-line bg-card p-3 shadow-soft"}>
      <Field label={t("sessionTypesAdmin.name")}>
        <TextInput value={row.name} onChange={(event) => handleChange({ name: event.target.value })} maxLength={80} />
      </Field>
      <div className="mt-1.5">
        <Field label={t("sessionTypesAdmin.description")}>
          <TextInput
            value={row.description ?? ""}
            onChange={(event) => handleChange({ description: event.target.value })}
            maxLength={500}
          />
        </Field>
      </div>
      <VariantsEditor
        variants={row.variants}
        showPriceCents={row.requiresPayment}
        onChange={(variants) => handleChange({ variants })}
      />
      <div className="mt-2 flex flex-col gap-1.5">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={row.active} onChange={(event) => handleChange({ active: event.target.checked })} />
          {t("sessionTypesAdmin.active")}
        </label>
        <RequiresPaymentField
          checked={row.requiresPayment}
          paymentsReady={paymentsReady}
          onChange={(requiresPayment) => handleChange({ requiresPayment })}
        />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={row.requiresValidation}
            onChange={(event) => handleChange({ requiresValidation: event.target.checked })}
          />
          {t("sessionTypesAdmin.requiresValidation")}
        </label>
      </div>
      <RoomCheckboxes
        rooms={rooms}
        selected={row.compatibleRoomIds}
        onChange={(compatibleRoomIds) => handleChange({ compatibleRoomIds })}
      />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button size="sm" onClick={handleSave} disabled={status === "saving"}>
          {status === "saving" ? t("sessionTypesAdmin.saving") : t("sessionTypesAdmin.save")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete}>
          {t("sessionTypesAdmin.delete")}
        </Button>
        {status === "saved" ? (
          <span role="status" className="text-sm text-ok">{t("sessionTypesAdmin.saved")}</span>
        ) : null}
      </div>
      <FormMessage tone="error">{saveError ?? ""}</FormMessage>
    </div>
  );
}
