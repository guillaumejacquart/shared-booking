"use client";

import { useState } from "react";

import { t } from "@/lib/i18n";
import { Button, Field, FormMessage, NumberInput, TextInput, Toggle } from "@/components/ui";
import PublicLinkCard from "@/components/PublicLinkCard";

interface Settings {
  name: string;
  address: string | null;
  enablePractitionerPages: boolean;
  enableOfficePage: boolean;
  bookingLeadTimeMin: number;
  cancelDeadlineHours: number;
  reminderHoursBefore: number;
  defaultBufferAfterMin: number;
}

export default function SettingsForm({
  officeId,
  officeSlug,
  initial,
}: {
  officeId: string;
  officeSlug: string;
  initial: Settings;
}) {
  const [form, setForm] = useState<Settings>(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof Settings>(k: K, v: Settings[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/offices/${officeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, address: form.address || null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error((j?.error as string) || t("booking.errorGeneric"));
      }
      setMessage({ ok: true, text: t("settings.saved") });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t("booking.errorGeneric") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <PublicLinkCard
        path={`/o/${officeSlug}`}
        title={t("settings.officePage")}
        description={t("settings.officePageHint")}
        enabled={form.enableOfficePage}
        disabledHint={t("settings.officePageOff")}
      />
    <form onSubmit={save} className="flex max-w-xl flex-col gap-4">
      <Field label="Cabinet">
        <TextInput value={form.name} onChange={(e) => set("name", e.target.value)} required maxLength={80} />
      </Field>
      <Field label={t("settings.address")}>
        <TextInput value={form.address ?? ""} onChange={(e) => set("address", e.target.value)} maxLength={200} />
      </Field>
      <Toggle
        label={t("settings.officePages")}
        checked={form.enablePractitionerPages}
        onChange={(v) => set("enablePractitionerPages", v)}
      />
      <Toggle
        label={t("settings.enableOfficePage")}
        checked={form.enableOfficePage}
        onChange={(v) => set("enableOfficePage", v)}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t("settings.leadTime")}>
          <NumberInput unit="min" value={form.bookingLeadTimeMin} min={0} max={1440} onChange={(e) => set("bookingLeadTimeMin", Number(e.target.value))} />
        </Field>
        <Field label={t("settings.cancelDeadline")}>
          <NumberInput unit="h" value={form.cancelDeadlineHours} min={0} max={168} onChange={(e) => set("cancelDeadlineHours", Number(e.target.value))} />
        </Field>
        <Field label={t("settings.reminder")}>
          <NumberInput unit="h" value={form.reminderHoursBefore} min={0} max={168} onChange={(e) => set("reminderHoursBefore", Number(e.target.value))} />
        </Field>
        <Field label={t("settings.buffer")}>
          <NumberInput unit="min" value={form.defaultBufferAfterMin} min={0} max={480} onChange={(e) => set("defaultBufferAfterMin", Number(e.target.value))} />
        </Field>
      </div>
      {message ? <FormMessage tone={message.ok ? "ok" : "error"}>{message.text}</FormMessage> : null}
      <Button type="submit" disabled={busy} className="w-fit">
        {t("settings.save")}
      </Button>
    </form>
    </div>
  );
}
