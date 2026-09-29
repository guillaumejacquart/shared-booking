"use client";

import { useState } from "react";

import { t } from "@/lib/i18n";
import { sendJson } from "@/lib/api-client";
import { notifyAvailabilitiesChanged } from "@/lib/availabilities-events";
import { Button, Field, FormMessage, Select, TextInput } from "@/components/ui";

const WEEKDAYS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

export interface RuleRow {
  key: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

export default function AvailabilityEditor({
  practitionerId,
  initial,
}: {
  practitionerId: string;
  initial: RuleRow[];
}) {
  const [rows, setRows] = useState<RuleRow[]>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function patch(key: string, data: Partial<RuleRow>) {
    setRows((rs) => rs.map((row) => (row.key === key ? { ...row, ...data } : row)));
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await sendJson("/api/availability", "PUT", {
          practitionerId,
          rules: rows.map((row) => ({
            weekday: row.weekday,
            startTime: row.startTime,
            endTime: row.endTime,
          })),
        });
      if (!result.ok) throw new Error(result.error);
      setMessage({ ok: true, text: t("dashboard.saved") });
      // Les règles ont changé : le calendrier recharge depuis l'API.
      notifyAvailabilitiesChanged();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t("booking.errorGeneric") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="grid gap-3">
        {rows.map((row) => (
          <div
            key={row.key}
            className="grid grid-cols-2 items-end gap-2 rounded-2xl border border-line bg-card p-3 shadow-soft sm:grid-cols-4"
          >
            <Field label="Jour">
              <Select value={row.weekday} onChange={(event) => patch(row.key, { weekday: Number(event.target.value) })}>
                {WEEKDAYS.map((label, index) => (
                  <option key={index} value={index}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Début">
              <TextInput type="time" value={row.startTime} onChange={(event) => patch(row.key, { startTime: event.target.value })} required />
            </Field>
            <Field label="Fin">
              <TextInput type="time" value={row.endTime} onChange={(event) => patch(row.key, { endTime: event.target.value })} required />
            </Field>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRows((rs) => rs.filter((other) => other.key !== row.key))}
            >
              {t("availability.delete")}
            </Button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          onClick={() =>
            setRows((rs) => [
              ...rs,
              {
                key: `new-${Date.now()}`,
                weekday: 1,
                startTime: "09:00",
                endTime: "12:00",
              },
            ])
          }
        >
          {t("availability.add")}
        </Button>
        <Button disabled={busy} onClick={save}>
          {t("sessionTypesAdmin.save")}
        </Button>
        {message ? <FormMessage tone={message.ok ? "ok" : "error"}>{message.text}</FormMessage> : null}
      </div>
    </div>
  );
}
