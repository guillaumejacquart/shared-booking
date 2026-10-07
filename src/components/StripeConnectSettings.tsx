"use client";

import { useState } from "react";

import { t } from "@/lib/i18n";
import type { StripeConnectStatus } from "@/services/stripe-connect";
import { Button, ConfirmButton, FormMessage } from "@/components/ui";

/**
 * Liaison Stripe Connect Express (par praticien).
 * État initial chargé côté serveur (page profil) ; actions via
 * `/api/stripe/connect/*`. La recherche `?stripe=retour` (retour onboarding)
 * déclenche un refresh automatique du statut.
 */
export default function StripeConnectSettings({
  initialStatus,
}: {
  initialStatus: StripeConnectStatus;
}) {
  const [status, setStatus] = useState<StripeConnectStatus>(initialStatus);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function showError(error: unknown) {
    setMessage({
      ok: false,
      text: error instanceof Error ? error.message : t("booking.errorGeneric"),
    });
  }

  async function readStatus(res: Response): Promise<StripeConnectStatus> {
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error((body?.error as string) || t("booking.errorGeneric"));
    return body as StripeConnectStatus;
  }

  async function start() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/stripe/connect/start", { method: "POST" });
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
      const res = await fetch("/api/stripe/connect/refresh", { method: "POST" });
      setStatus(await readStatus(res));
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/stripe/connect/connection", { method: "DELETE" });
      setStatus(await readStatus(res));
      setMessage({ ok: true, text: t("dashboard.saved") });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  if (!status.configured) {
    return <p className="text-sm text-mist">{t("stripeConnect.notConfigured")}</p>;
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <p className="text-sm text-mist">{t("stripeConnect.hint")}</p>
      {!status.accountId ? <p className="text-sm text-mist">{t("stripeConnect.unlinked")}</p> : null}
      {status.ready ? (
        <p className="text-sm">{t("stripeConnect.ready")}</p>
      ) : status.accountId ? (
        <p className="text-sm">{t("stripeConnect.pending")}</p>
      ) : null}
      {status.accountId && status.chargesEnabled && !status.payoutsEnabled ? (
        <p className="text-sm text-mist">{t("stripeConnect.payoutsPending")}</p>
      ) : null}
      {message ? (
        <FormMessage tone={message.ok ? "ok" : "error"}>{message.text}</FormMessage>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={start} disabled={busy} className="w-fit">
          {status.accountId ? t("stripeConnect.continue") : t("stripeConnect.connect")}
        </Button>
        {status.accountId ? (
          <Button variant="secondary" onClick={refresh} disabled={busy} className="w-fit">
            {t("stripeConnect.refresh")}
          </Button>
        ) : null}
        {status.accountId ? (
          <ConfirmButton confirmLabel={t("stripeConnect.disconnectConfirm")} onConfirm={disconnect} busy={busy}>
            {t("stripeConnect.disconnect")}
          </ConfirmButton>
        ) : null}
      </div>
    </div>
  );
}
