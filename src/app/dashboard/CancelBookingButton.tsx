"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { t } from "@/lib/i18n";
import { sendJson } from "@/lib/api-client";
import { Button, Field, FormMessage, TextInput } from "@/components/ui";

/** Annulation praticien depuis l'agenda (motif obligatoire, patient notifié). */
export default function CancelBookingButton({
  cancelToken,
  onDone,
}: {
  cancelToken: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function cancel() {
    if (!reason.trim()) {
      setError(t("agenda.reason"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await sendJson("/api/b/cancel", "POST", { token: cancelToken, by: "practitioner", reason });
      if (!result.ok) throw new Error(result.error);
      setDone(true);
      onDone?.();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("booking.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  if (done) return <p className="text-sm text-green-700">{t("agenda.cancelled")}</p>;

  if (!confirming) {
    return (
      <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
        {t("agenda.cancel")}
      </Button>
    );
  }

  return (
    <div className="flex max-w-sm flex-col gap-2">
      <p className="text-xs text-mist">{t("agenda.confirmCancel")}</p>
      <Field label={t("agenda.reason")}>
        <TextInput value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
      </Field>
      <FormMessage tone="error">{error ?? ""}</FormMessage>
      <div className="flex gap-2">
        <Button size="sm" variant="danger" disabled={busy} onClick={cancel}>
          {t("agenda.cancel")}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
          {t("booking.back")}
        </Button>
      </div>
    </div>
  );
}
