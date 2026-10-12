"use client";

import { useState } from "react";

import { t } from "@/lib/i18n";
import { Button, Field, FormMessage, TextInput } from "@/components/ui";

export interface ValidateData {
  practitionerName: string;
  sessionName: string;
  startAt: string;
  patientName: string;
  notes: string | null;
  token: string;
}

/** Valider / refuser une demande depuis le lien magique (sans connexion). */
export default function ValidateClient({
  data,
  when,
}: {
  data: ValidateData;
  when: string;
}) {
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function act(accept: boolean) {
    if (!accept && !reason.trim()) {
      setError(t("validate.reasonRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/b/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: data.token, accept, reason: accept ? undefined : reason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          (body?.error as string) || (body?.code as string) || t("booking.errorGeneric"),
        );
      }
      setDone(accept ? t("validate.accepted") : t("validate.refused"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("booking.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="rounded-3xl border border-line bg-card p-6 text-center shadow-soft">{done}</p>
    );
  }

  return (
    <section className="rounded-3xl border border-line bg-card p-6 shadow-soft">
      <h2 className="text-lg font-semibold">
        {data.sessionName} {t("validate.with")} {data.patientName}
      </h2>
      <p className="mt-1 text-mist">{when}</p>
      {data.notes ? (
        <p className="mt-3 text-sm">
          <span className="font-medium">{t("validate.notes")} : </span>
          {data.notes}
        </p>
      ) : null}
      {!refusing ? (
        <div className="mt-4 flex gap-2">
          <Button disabled={busy} onClick={() => void act(true)}>
            {t("validate.accept")}
          </Button>
          <Button variant="secondary" onClick={() => setRefusing(true)}>
            {t("validate.refuse")}
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          <Field label={t("validate.reasonLabel")}>
            <TextInput
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              placeholder={t("validate.reasonPlaceholder")}
            />
          </Field>
          <FormMessage tone="error">{error ?? ""}</FormMessage>
          <div className="flex gap-2">
            <Button variant="danger" disabled={busy} onClick={() => void act(false)}>
              {t("validate.refuse")}
            </Button>
            <Button variant="ghost" onClick={() => setRefusing(false)}>
              {t("validate.backToRefuse")}
            </Button>
          </div>
        </div>
      )}
      <FormMessage tone="error">{!refusing ? (error ?? "") : ""}</FormMessage>
    </section>
  );
}
