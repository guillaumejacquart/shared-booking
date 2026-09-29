"use client";

import { useCallback, useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { t } from "@/lib/i18n";
import {
  Button,
  ConfirmButton,
  Field,
  FormMessage,
  Select,
  Toggle,
} from "@/components/ui";

interface GooglePrefs {
  syncEnabled: boolean;
  calendarId: string;
  showPatientName: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
}

interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  prefs: GooglePrefs | null;
}

/**
 * Push des réservations vers Google Agenda (outbound, par praticien).
 * Connexion via Better Auth (`/link-social`), préférences via
 * `/api/google/status`, resynchro manuelle via `/api/google/connection`.
 */
export default function GoogleAgendaSettings() {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [calendars, setCalendars] = useState<
    { id: string; summary: string; primary?: boolean }[]
  >([]);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [calendarId, setCalendarId] = useState("primary");
  const [showPatientName, setShowPatientName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/google/status");
      if (!res.ok) throw new Error(t("booking.errorGeneric"));
      const s = (await res.json()) as GoogleStatus;
      setStatus(s);
      setSyncEnabled(s.prefs?.syncEnabled ?? false);
      setCalendarId(s.prefs?.calendarId ?? "primary");
      setShowPatientName(s.prefs?.showPatientName ?? false);
      if (s.connected) {
        const cal = await fetch("/api/google/calendars");
        if (cal.ok) {
          const j = (await cal.json()) as {
            calendars: { id: string; summary: string; primary?: boolean }[];
          };
          setCalendars(j.calendars);
        }
      }
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof Error ? err.message : t("booking.errorGeneric"),
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect() {
    setBusy(true);
    setMessage(null);
    try {
      await authClient.linkSocialAccount({
        provider: "google",
        callbackURL: "/dashboard/profil?tab=google",
      });
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof Error ? err.message : t("booking.errorGeneric"),
      });
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
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error((j?.error as string) || t("booking.errorGeneric"));
      setStatus(j as GoogleStatus);
      setMessage({ ok: true, text: t("dashboard.saved") });
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof Error ? err.message : t("booking.errorGeneric"),
      });
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
      await load();
      setMessage({ ok: true, text: t("dashboard.saved") });
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof Error ? err.message : t("booking.errorGeneric"),
      });
    } finally {
      setBusy(false);
    }
  }

  async function resync() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/google/connection", { method: "POST" });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error((j?.error as string) || t("booking.errorGeneric"));
      await load();
      setMessage({
        ok: (j?.failed as number) === 0,
        text: t("google.resyncDone", {
          ok: (j?.ok as number) ?? 0,
          failed: (j?.failed as number) ?? 0,
        }),
      });
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof Error ? err.message : t("booking.errorGeneric"),
      });
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return <p className="text-sm text-mist">{t("booking.loading")}</p>;
  }

  if (!status.configured) {
    return <p className="text-sm text-mist">{t("google.notConfigured")}</p>;
  }

  if (!status.connected) {
    return (
      <div className="flex max-w-xl flex-col gap-4">
        <p className="text-sm text-mist">{t("google.connectHint")}</p>
        {message ? (
          <FormMessage tone={message.ok ? "ok" : "error"}>{message.text}</FormMessage>
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
        <Select value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
          {calendars.length === 0 ? (
            <option value="primary">Agenda principal</option>
          ) : (
            calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.summary}
              </option>
            ))
          )}
        </Select>
      </Field>
      <Toggle checked={syncEnabled} onChange={setSyncEnabled} label={t("google.syncEnabled")} />
      <Toggle
        checked={showPatientName}
        onChange={setShowPatientName}
        label={t("google.showPatientName")}
      />
      <p className="text-sm text-mist">{t("google.privacyHint")}</p>
      {status.prefs?.lastSyncAt ? (
        <p className="text-sm text-mist">
          {t("google.lastSync", { when: new Date(status.prefs.lastSyncAt).toLocaleString("fr-FR") })}
        </p>
      ) : null}
      {status.prefs?.lastError ? (
        <FormMessage tone="error">{status.prefs.lastError}</FormMessage>
      ) : null}
      {message ? (
        <FormMessage tone={message.ok ? "ok" : "error"}>{message.text}</FormMessage>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={busy} className="w-fit">
          {t("sessionTypesAdmin.save")}
        </Button>
        <Button variant="secondary" onClick={resync} disabled={busy} className="w-fit">
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
