"use client";

import { useState } from "react";

import { t } from "@/lib/i18n";
import type { GoogleStatus } from "@/lib/services/google";
import {
  Button,
  ConfirmButton,
  Field,
  FormMessage,
  Select,
  Toggle,
} from "@/components/ui";

export interface GoogleCalendar {
  id: string;
  summary: string;
  primary?: boolean;
}

/**
 * Push des réservations vers Google Agenda (outbound, par praticien).
 * État initial chargé côté serveur (page profil) ; connexion via
 * `POST /api/auth/link-social`, préférences via `/api/google/status`,
 * resynchro manuelle via `/api/google/connection`.
 */
export default function GoogleAgendaSettings({
  initialStatus,
  initialCalendars,
}: {
  initialStatus: GoogleStatus;
  initialCalendars: GoogleCalendar[];
}) {
  const [status, setStatus] = useState<GoogleStatus>(initialStatus);
  const [calendars, setCalendars] = useState<GoogleCalendar[]>(initialCalendars);
  const [syncEnabled, setSyncEnabled] = useState(
    initialStatus.prefs?.syncEnabled ?? false,
  );
  const [calendarId, setCalendarId] = useState(
    initialStatus.prefs?.calendarId ?? "primary",
  );
  const [showPatientName, setShowPatientName] = useState(
    initialStatus.prefs?.showPatientName ?? false,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  function showError(error: unknown) {
    setMessage({
      ok: false,
      text: error instanceof Error ? error.message : t("booking.errorGeneric"),
    });
  }

  function applyStatus(next: GoogleStatus) {
    setStatus(next);
    setSyncEnabled(next.prefs?.syncEnabled ?? false);
    setCalendarId(next.prefs?.calendarId ?? "primary");
    setShowPatientName(next.prefs?.showPatientName ?? false);
  }

  async function refresh() {
    const res = await fetch("/api/google/status");
    if (!res.ok) throw new Error(t("booking.errorGeneric"));
    applyStatus((await res.json()) as GoogleStatus);
    const calRes = await fetch("/api/google/calendars");
    if (calRes.ok) {
      const body = (await calRes.json()) as { calendars: GoogleCalendar[] };
      setCalendars(body.calendars);
    }
  }

  async function connect() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/link-social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "google",
          callbackURL: "/dashboard/profil?tab=google",
          disableRedirect: true,
        }),
      });
      const body = (await res.json().catch(() => null)) as { url?: string } | null;
      if (!res.ok || !body?.url) {
        throw new Error(
          ((body as { error?: string } | null)?.error as string) ||
            t("booking.errorGeneric"),
        );
      }
      window.location.href = body.url;
    } catch (error) {
      showError(error);
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/google/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ syncEnabled, calendarId, showPatientName }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok)
        throw new Error((body?.error as string) || t("booking.errorGeneric"));
      applyStatus(body as GoogleStatus);
      setMessage({ ok: true, text: t("dashboard.saved") });
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
      const res = await fetch("/api/google/connection", { method: "DELETE" });
      if (!res.ok) throw new Error(t("booking.errorGeneric"));
      await refresh();
      setMessage({ ok: true, text: t("dashboard.saved") });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function resync() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/google/connection", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok)
        throw new Error((body?.error as string) || t("booking.errorGeneric"));
      await refresh();
      setMessage({
        ok: (body?.failed as number) === 0,
        text: t("google.resyncDone", {
          ok: (body?.ok as number) ?? 0,
          failed: (body?.failed as number) ?? 0,
        }),
      });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  if (!status.configured) {
    return <p className="text-sm text-mist">{t("google.notConfigured")}</p>;
  }

  if (!status.connected) {
    return (
      <div className="flex max-w-xl flex-col gap-4">
        <p className="text-sm text-mist">{t("google.connectHint")}</p>
        {message ? (
          <FormMessage tone={message.ok ? "ok" : "error"}>
            {message.text}
          </FormMessage>
        ) : null}
        <Button onClick={connect} disabled={busy} className="w-fit">
          {t("google.connect")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <Field label={t("google.calendar")}>
        <Select
          value={calendarId}
          onChange={(event) => setCalendarId(event.target.value)}
        >
          {calendars.length === 0 ? (
            <option value="primary">Agenda principal</option>
          ) : (
            calendars.map((cal) => (
              <option key={cal.id} value={cal.id}>
                {cal.summary}
              </option>
            ))
          )}
        </Select>
      </Field>
      <Toggle
        checked={syncEnabled}
        onChange={setSyncEnabled}
        label={t("google.syncEnabled")}
      />
      <Toggle
        checked={showPatientName}
        onChange={setShowPatientName}
        label={t("google.showPatientName")}
      />
      <p className="text-sm text-mist">{t("google.privacyHint")}</p>
      {status.prefs?.lastSyncAt ? (
        <p className="text-sm text-mist">
          {t("google.lastSync", {
            when: new Date(status.prefs.lastSyncAt).toLocaleString("fr-FR"),
          })}
        </p>
      ) : null}
      {status.prefs?.lastError ? (
        <FormMessage tone="error">{status.prefs.lastError}</FormMessage>
      ) : null}
      {message ? (
        <FormMessage tone={message.ok ? "ok" : "error"}>
          {message.text}
        </FormMessage>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={busy} className="w-fit">
          {t("sessionTypesAdmin.save")}
        </Button>
        <Button
          variant="secondary"
          onClick={resync}
          disabled={busy}
          className="w-fit"
        >
          {t("google.resync")}
        </Button>
        <ConfirmButton
          confirmLabel={t("google.disconnectConfirm")}
          onConfirm={disconnect}
          busy={busy}
        >
          {t("google.disconnect")}
        </ConfirmButton>
      </div>
    </div>
  );
}
