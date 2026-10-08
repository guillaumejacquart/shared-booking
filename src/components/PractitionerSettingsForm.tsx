"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { t } from "@/lib/i18n";
import { sendJson } from "@/lib/api-client";
import { Button, Checkbox, Field, FormMessage, Select } from "@/components/ui";

/** Onglet Paramètres : pas de grille + défaut de validation manuelle. */
export default function PractitionerSettingsForm({
  practitionerId,
  initial,
}: {
  practitionerId: string;
  initial: { slotStepMin: number; requiresValidationDefault: boolean };
}) {
  const router = useRouter();
  const [slotStepMin, setSlotStepMin] = useState(String(initial.slotStepMin ?? 15));
  const [requiresValidationDefault, setRequiresValidationDefault] = useState(
    initial.requiresValidationDefault ?? false,
  );
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await sendJson(`/api/practitioners/${practitionerId}/settings`, "PATCH", {
        slotStepMin: Number(slotStepMin),
        requiresValidationDefault,
      });
      if (!result.ok) throw new Error(result.error);
      setMessage({ ok: true, text: t("dashboard.saved") });
      router.refresh();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t("booking.errorGeneric") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="flex max-w-xl flex-col gap-4">
      <Field label={t("profile.slotStep")} hint={t("profile.slotStepHint")}>
        <Select value={slotStepMin} onChange={(event) => setSlotStepMin(event.target.value)}>
          {[5, 10, 15, 20, 30, 60].map((step) => (
            <option key={step} value={step}>
              {t("profile.slotStepOption", { n: step })}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("profile.defaultValidation")} hint={t("profile.defaultValidationHint")}>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={requiresValidationDefault}
            onChange={(event) => setRequiresValidationDefault(event.target.checked)}
          />
          {t("sessionTypesAdmin.requiresValidation")}
        </label>
      </Field>
      {message ? <FormMessage tone={message.ok ? "ok" : "error"}>{message.text}</FormMessage> : null}
      <Button type="submit" disabled={busy} className="w-fit">
        {t("sessionTypesAdmin.save")}
      </Button>
    </form>
  );
}
