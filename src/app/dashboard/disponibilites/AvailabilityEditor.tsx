"use client";

import { useState } from "react";

import { t } from "@/lib/i18n";
import { sendJson } from "@/lib/api-client";
import { notifyAvailabilitiesChanged } from "@/lib/availabilities-events";
import { Badge, Button, FormMessage, TextInput } from "@/components/ui";

const DAYS = [
  { weekday: 1, label: "Lundi" },
  { weekday: 2, label: "Mardi" },
  { weekday: 3, label: "Mercredi" },
  { weekday: 4, label: "Jeudi" },
  { weekday: 5, label: "Vendredi" },
  { weekday: 6, label: "Samedi" },
  { weekday: 0, label: "Dimanche" },
];

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

  function slotsOf(weekday: number): RuleRow[] {
    return rows
      .filter((row) => row.weekday === weekday)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  function addSlot(weekday: number) {
    setRows((rs) => [
      ...rs,
      {
        key: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        weekday,
        startTime: "09:00",
        endTime: "12:00",
      },
    ]);
  }

  function setDayOpen(weekday: number, open: boolean) {
    if (open) {
      if (slotsOf(weekday).length === 0) addSlot(weekday);
    } else {
      setRows((rs) => rs.filter((row) => row.weekday !== weekday));
    }
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
      <div className="overflow-x-auto rounded-2xl border border-line bg-card shadow-soft">
        <table className="w-full min-w-[620px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-mist">
              <th scope="col" className="px-4 py-3 font-medium">Jour</th>
              <th scope="col" className="px-4 py-3 font-medium">Statut</th>
              <th scope="col" className="px-4 py-3 font-medium">Horaires</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {DAYS.map((day) => {
              const slots = slotsOf(day.weekday);
              const open = slots.length > 0;
              return (
                <tr key={day.weekday} className="border-b border-line align-top last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 font-medium">{day.label}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={open ? "green" : "red"}>{open ? "Ouvert" : "Fermé"}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    {!open ? (
                      <span className="text-mist">—</span>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {slots.map((slot) => (
                          <li key={slot.key} className="flex flex-wrap items-center gap-x-3 gap-y-2">
                            <span className="inline-flex shrink-0 items-center gap-2">
                              <TextInput
                                type="time"
                                aria-label={`Début ${day.label}`}
                                className="w-28 min-w-28"
                                value={slot.startTime}
                                onChange={(event) => patch(slot.key, { startTime: event.target.value })}
                                required
                              />
                              <span aria-hidden="true" className="shrink-0 text-mist">–</span>
                              <TextInput
                                type="time"
                                aria-label={`Fin ${day.label}`}
                                className="w-28 min-w-28"
                                value={slot.endTime}
                                onChange={(event) => patch(slot.key, { endTime: event.target.value })}
                                required
                              />
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Supprimer la plage ${slot.startTime} – ${slot.endTime} du ${day.label}`}
                              onClick={() => setRows((rs) => rs.filter((other) => other.key !== slot.key))}
                            >
                              {t("availability.delete")}
                            </Button>
                          </li>
                        ))}
                        <li>
                          <Button size="sm" variant="ghost" onClick={() => addSlot(day.weekday)}>
                            + Ajouter une plage
                          </Button>
                        </li>
                      </ul>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setDayOpen(day.weekday, !open)}
                    >
                      {open ? "Fermer" : "Ouvrir"}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button disabled={busy} onClick={save}>
          {t("sessionTypesAdmin.save")}
        </Button>
        {message ? <FormMessage tone={message.ok ? "ok" : "error"}>{message.text}</FormMessage> : null}
      </div>
    </div>
  );
}
