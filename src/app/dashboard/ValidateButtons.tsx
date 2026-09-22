"use client";

import { useEffect, useRef, useState } from "react";

import { t } from "@/lib/i18n";
import { Button, Field, FormMessage, TextInput } from "@/components/ui";

/**
 * Valider / refuser une demande en attente. Succès affiché ~1,5 s
 * (l'utilisateur voit que ça a marché) puis `onDone` (refresh + fermeture).
 */
export default function ValidateButtons({
  bookingId,
  onDone,
}: {
  bookingId: string;
  onDone: () => void;
}) {
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  async function act(accept: boolean) {
    if (!accept && !reason.trim()) {
      setError(t("agenda.refuseReason"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept, reason: accept ? undefined : reason }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(
          (j?.error as string) || (j?.code as string) || t("booking.errorGeneric"),
        );
      }
      setDone(accept ? t("agenda.validated") : t("agenda.refused"));
      timer.current = window.setTimeout(onDone, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("booking.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  if (done) return <p className="text-sm text-ok">{done}</p>;

  if (!refusing) {
    return (
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => void act(true)}>
          {t("agenda.validate")}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setRefusing(true)}>
          {t("agenda.refuse")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Field label={t("agenda.refuseReason")}>
        <TextInput value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </Field>
      <FormMessage tone="error">{error ?? ""}</FormMessage>
      <div className="flex gap-2">
        <Button size="sm" variant="danger" disabled={busy} onClick={() => void act(false)}>
          {t("agenda.refuse")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setRefusing(false)}>
          {t("booking.back")}
        </Button>
      </div>
    </div>
  );
}
