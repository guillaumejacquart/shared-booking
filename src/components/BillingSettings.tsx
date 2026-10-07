"use client";

import { useState } from "react";

import { t } from "@/lib/i18n";
import type { BillingStatus } from "@/services/billing";
import { Button, FormMessage } from "@/components/ui";

/**
 * Abonnement du cabinet (10 €/mois, payé par le owner).
 * État initial chargé côté serveur (page paramètres) ; actions via
 * `/api/billing/*`. Non bloquant : sans abonnement, un bandeau le rappelle.
 */
export default function BillingSettings({
  initialStatus,
}: {
  initialStatus: BillingStatus;
}) {
  const [status, setStatus] = useState<BillingStatus>(initialStatus);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function showError(error: unknown) {
    setMessage({
      ok: false,
      text: error instanceof Error ? error.message : t("booking.errorGeneric"),
    });
  }

  async function readStatus(res: Response): Promise<BillingStatus> {
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error((body?.error as string) || t("booking.errorGeneric"));
    return body as BillingStatus;
  }

  async function subscribe() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.url) {
        throw new Error((body?.error as string) || t("booking.errorGeneric"));
      }
      window.location.href = body.url as string;
    } catch (error) {
      showError(error);
      setBusy(false);
    }
  }

  async function portal() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.url) {
        throw new Error((body?.error as string) || t("booking.errorGeneric"));
      }
      window.location.href = body.url as string;
    } catch (error) {
      showError(error);
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/billing/refresh", { method: "POST" });
      setStatus(await readStatus(res));
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  if (!status.configured || !status.priceConfigured) {
    return <p className="text-sm text-mist">{t("billing.notConfigured")}</p>;
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <p className="text-sm text-mist">{t("billing.hint")}</p>
      {status.active ? (
        <p className="text-sm">
          {t("billing.active", {
            when: status.currentPeriodEnd
              ? new Date(status.currentPeriodEnd).toLocaleDateString("fr-FR")
              : "—",
          })}
        </p>
      ) : status.status === "past_due" ? (
        <p className="text-sm">{t("billing.pastDue")}</p>
      ) : (
        <p className="text-sm text-mist">{t("billing.inactive")}</p>
      )}
      {message ? (
        <FormMessage tone={message.ok ? "ok" : "error"}>{message.text}</FormMessage>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!status.active ? (
          <Button onClick={subscribe} disabled={busy} className="w-fit">
            {t("billing.subscribe")}
          </Button>
        ) : (
          <Button onClick={portal} disabled={busy} className="w-fit">
            {t("billing.manage")}
          </Button>
        )}
        <Button variant="secondary" onClick={refresh} disabled={busy} className="w-fit">
          {t("billing.refresh")}
        </Button>
      </div>
    </div>
  );
}
