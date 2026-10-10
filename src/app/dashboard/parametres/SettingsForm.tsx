"use client";

import { useState } from "react";

import { t } from "@/lib/i18n";
import { sendJson } from "@/lib/api-client";
import { parseMode, parsePalette, type PaletteId, type ThemeMode } from "@/lib/theme";
import { Button, Field, FormMessage, NumberInput, Textarea, TextInput, Toggle } from "@/components/ui";
import PublicLinkCard from "@/components/PublicLinkCard";
import ThemePicker from "@/components/ThemePicker";

interface Settings {
  name: string;
  address: string | null;
  accessInfo: string | null;
  enablePractitionerPages: boolean;
  enableOfficePage: boolean;
  bookingLeadTimeMin: number;
  cancelDeadlineHours: number;
  reminderHoursBefore: number;
  defaultBufferAfterMin: number;
  themePalette: PaletteId;
  themeMode: ThemeMode;
}

export default function SettingsForm({
  officeId,
  officeSlug,
  initial,
}: {
  officeId: string;
  officeSlug: string;
  initial: Omit<Settings, "themePalette" | "themeMode"> & { themePalette: string; themeMode: string };
}) {
  const [form, setForm] = useState<Settings>(() => ({
    ...initial,
    themePalette: parsePalette(initial.themePalette),
    themeMode: parseMode(initial.themeMode),
  }));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  /** Aperçu immédiat : le tableau de bord suit l'ambiance enregistrée. */
  function applyOfficeTheme(palette: PaletteId, mode: ThemeMode) {
    const root = document.getElementById("dashboard-theme") ?? document.documentElement;
    root.dataset.palette = palette;
    root.dataset.mode = mode;
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await sendJson(`/api/offices/${officeId}`, "PATCH", { ...form, address: form.address || null, accessInfo: form.accessInfo || null });
      if (!result.ok) throw new Error(result.error);
      // Thème unique : le tableau de bord suit l'ambiance (aperçu immédiat).
      applyOfficeTheme(form.themePalette, form.themeMode);
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
        <TextInput value={form.name} onChange={(event) => set("name", event.target.value)} required maxLength={80} />
      </Field>
      <Field label={t("settings.address")}>
        <TextInput value={form.address ?? ""} onChange={(event) => set("address", event.target.value)} maxLength={200} />
      </Field>
      <Field label={t("settings.accessInfo")} hint={t("settings.accessInfoHint")}>
        <Textarea value={form.accessInfo ?? ""} onChange={(event) => set("accessInfo", event.target.value)} rows={3} maxLength={1000} placeholder={t("settings.accessInfoPlaceholder")} />
      </Field>
      <Toggle
        label={t("settings.officePages")}
        checked={form.enablePractitionerPages}
        onChange={(checked) => set("enablePractitionerPages", checked)}
      />
      <Toggle
        label={t("settings.enableOfficePage")}
        checked={form.enableOfficePage}
        onChange={(checked) => set("enableOfficePage", checked)}
      />
      <div className="rounded-3xl border border-line bg-card p-4 shadow-soft">
        <h2 className="text-base font-semibold">{t("settings.ambiance")}</h2>
        <p className="mt-1 text-sm text-mist">{t("settings.ambianceHint")}</p>
        <div className="mt-3">
          <ThemePicker
            palette={form.themePalette}
            mode={form.themeMode}
            onPalette={(palette) => set("themePalette", palette)}
            onMode={(mode) => set("themeMode", mode)}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t("settings.leadTime")}>
          <NumberInput unit="min" value={form.bookingLeadTimeMin} min={0} max={1440} onChange={(event) => set("bookingLeadTimeMin", Number(event.target.value))} />
        </Field>
        <Field label={t("settings.cancelDeadline")}>
          <NumberInput unit="h" value={form.cancelDeadlineHours} min={0} max={168} onChange={(event) => set("cancelDeadlineHours", Number(event.target.value))} />
        </Field>
        <Field label={t("settings.reminder")}>
          <NumberInput unit="h" value={form.reminderHoursBefore} min={0} max={168} onChange={(event) => set("reminderHoursBefore", Number(event.target.value))} />
        </Field>
        <Field label={t("settings.buffer")}>
          <NumberInput unit="min" value={form.defaultBufferAfterMin} min={0} max={480} onChange={(event) => set("defaultBufferAfterMin", Number(event.target.value))} />
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
