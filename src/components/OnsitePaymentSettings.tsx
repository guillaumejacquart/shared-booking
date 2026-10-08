"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { t } from "@/lib/i18n";
import { sendJson } from "@/lib/api-client";
import {
  ONSITE_PAYMENT_METHODS,
  formatOnsitePaymentMethods,
  type OnsitePaymentMethod,
} from "@/lib/onsite-payments";
import { Button, Checkbox, Field, FormMessage, TextInput } from "@/components/ui";

const METHOD_KEYS: Record<OnsitePaymentMethod, string> = {
  especes: "onsite.methodEspeces",
  carte: "onsite.methodCarte",
  virement: "onsite.methodVirement",
  cheque: "onsite.methodCheque",
};

/**
 * Moyens de paiement acceptés sur place (onglet Paiements, sous Stripe).
 * Cases à cocher + précision libre, affichés aux patients pour les séances
 * à tarif affiché sans paiement en ligne.
 */
export default function OnsitePaymentSettings({
  practitionerId,
  initial,
}: {
  practitionerId: string;
  initial: { methods: OnsitePaymentMethod[]; note: string | null };
}) {
  const router = useRouter();
  const [methods, setMethods] = useState<OnsitePaymentMethod[]>(initial.methods);
  const [note, setNote] = useState(initial.note ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(method: OnsitePaymentMethod) {
    setMethods((prev) =>
      prev.includes(method) ? prev.filter((kept) => kept !== method) : [...prev, method],
    );
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await sendJson(`/api/practitioners/${practitionerId}/settings`, "PATCH", {
        onsitePaymentMethods: methods,
        onsitePaymentNote: note.trim() || "",
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

  const preview = formatOnsitePaymentMethods(
    methods,
    Object.fromEntries(
      ONSITE_PAYMENT_METHODS.map((method) => [method, t(METHOD_KEYS[method])]),
    ) as Record<OnsitePaymentMethod, string>,
  );

  return (
    <form onSubmit={save} className="flex max-w-xl flex-col gap-4">
      <Field label={t("onsite.title")} hint={t("onsite.hint")}>
        <div className="flex flex-col gap-2">
          {ONSITE_PAYMENT_METHODS.map((method) => (
            <label key={method} className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={methods.includes(method)} onChange={() => toggle(method)} />
              {t(METHOD_KEYS[method])}
            </label>
          ))}
        </div>
      </Field>
      <Field label={t("onsite.noteLabel")}>
        <TextInput
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={200}
          placeholder={t("onsite.notePlaceholder")}
        />
      </Field>
      {preview ? (
        <p className="text-sm text-mist">
          {t("booking.payOnSite")} — {t("booking.payOnSiteMethods", { methods: preview })}
          {note.trim() ? ` · ${note.trim()}` : ""}
        </p>
      ) : (
        <p className="text-sm text-mist">{t("onsite.empty")}</p>
      )}
      {message ? <FormMessage tone={message.ok ? "ok" : "error"}>{message.text}</FormMessage> : null}
      <Button type="submit" disabled={busy} className="w-fit">
        {t("sessionTypesAdmin.save")}
      </Button>
    </form>
  );
}
