"use client";

import { useState } from "react";

import { t } from "@/lib/i18n";
import { notifyAvailabilitiesChanged } from "@/lib/availabilities-events";
import { Button, Field, FormMessage, Select, TextInput } from "@/components/ui";

const WEEKDAYS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

export interface RuleRow {
  key: string;
  weekday: number;
  startTime: string;
  endTime: string;
  roomId: string;
}

export default function AvailabilityEditor({
  practitionerId,
  initial,
  rooms,
}: {
  practitionerId: string;
  initial: RuleRow[];
  rooms: { id: string; name: string }[];
}) {
  const [rows, setRows] = useState<RuleRow[]>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function patch(key: string, data: Partial<RuleRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...data } : r)));
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/availability", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          practitionerId,
          rules: rows.map((r) => ({
            weekday: r.weekday,
            startTime: r.startTime,
            endTime: r.endTime,
            roomId: r.roomId,
          })),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error((j?.error as string) || t("booking.errorGeneric"));
      }
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
        {rows.map((r) => (
          <div
            key={r.key}
            className="grid grid-cols-2 items-end gap-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800 sm:grid-cols-5"
          >
            <Field label="Jour">
              <Select value={r.weekday} onChange={(e) => patch(r.key, { weekday: Number(e.target.value) })}>
                {WEEKDAYS.map((d, i) => (
                  <option key={i} value={i}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Début">
              <TextInput type="time" value={r.startTime} onChange={(e) => patch(r.key, { startTime: e.target.value })} required />
            </Field>
            <Field label="Fin">
              <TextInput type="time" value={r.endTime} onChange={(e) => patch(r.key, { endTime: e.target.value })} required />
            </Field>
            <Field label={t("availability.room")}>
              <Select value={r.roomId} onChange={(e) => patch(r.key, { roomId: e.target.value })}>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
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
                roomId: rooms[0]?.id ?? "",
              },
            ])
          }
        >
          {t("availability.add")}
        </Button>
        <Button disabled={busy || rooms.length === 0} onClick={save}>
          {t("sessionTypesAdmin.save")}
        </Button>
        {message ? <FormMessage tone={message.ok ? "ok" : "error"}>{message.text}</FormMessage> : null}
      </div>
    </div>
  );
}
