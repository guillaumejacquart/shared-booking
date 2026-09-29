"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { t } from "@/lib/i18n";
import { sendJson } from "@/lib/api-client";
import { notifyAvailabilitiesChanged } from "@/lib/availabilities-events";
import { Button, Checkbox, Field, FormMessage, Select, TextInput } from "@/components/ui";

export interface ExceptionRow {
  id: string;
  date: string;
  kind: string;
  startTime: string | null;
  endTime: string | null;
  fullDay: boolean;
  roomId: string | null;
  reason: string | null;
}

export default function ExceptionsManager({
  practitionerId,
  initial,
  rooms,
}: {
  practitionerId: string;
  initial: ExceptionRow[];
  rooms: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [kind, setKind] = useState<"off" | "extra">("off");
  const [date, setDate] = useState("");
  const [fullDay, setFullDay] = useState(true);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("12:00");
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await sendJson("/api/exceptions", "POST", {
          practitionerId,
          date,
          kind,
          fullDay: kind === "off" ? fullDay : false,
          startTime: fullDay && kind === "off" ? undefined : startTime,
          endTime: fullDay && kind === "off" ? undefined : endTime,
          roomId: kind === "extra" ? roomId : undefined,
          reason: reason || undefined,
        });
      if (!result.ok) throw new Error(result.error);
      setDate("");
      setReason("");
      notifyAvailabilitiesChanged();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("booking.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/exceptions/${id}?practitionerId=${practitionerId}`, { method: "DELETE" });
    notifyAvailabilitiesChanged();
    router.refresh();
  }

  return (
    <div>
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <Field label="Type">
          <Select value={kind} onChange={(event) => setKind(event.target.value as "off" | "extra")}>
            <option value="off">{t("availability.dayOff")}</option>
            <option value="extra">{t("availability.extra")}</option>
          </Select>
        </Field>
        <Field label="Date">
          <TextInput type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </Field>
        {kind === "off" ? (
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Checkbox checked={fullDay} onChange={(event) => setFullDay(event.target.checked)} />
            {t("availability.dayOff")}
          </label>
        ) : null}
        {!(kind === "off" && fullDay) ? (
          <>
            <Field label="Début">
              <TextInput type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} required />
            </Field>
            <Field label="Fin">
              <TextInput type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} required />
            </Field>
          </>
        ) : null}
        {kind === "extra" ? (
          <Field label={t("availability.room")}>
            <Select value={roomId} onChange={(event) => setRoomId(event.target.value)}>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label={t("availability.reason")}>
          <TextInput value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} />
        </Field>
        <Button type="submit" disabled={busy}>
          {t("availability.add")}
        </Button>
      </form>
      <FormMessage tone="error">{error ?? ""}</FormMessage>
      <ul className="mt-3 grid gap-2">
        {initial.map((exception) => (
          <li
            key={exception.id}
            className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-card p-2 text-sm shadow-soft"
          >
            <span className="font-medium">{exception.date}</span>
            <span className="text-mist">
              {exception.kind === "off" ? t("availability.dayOff") : t("availability.extra")}
              {exception.fullDay ? "" : ` ${exception.startTime}→${exception.endTime}`}
              {exception.reason ? ` · ${exception.reason}` : ""}
            </span>
            <Button size="sm" variant="ghost" onClick={() => void remove(exception.id)} className="ml-auto">
              {t("availability.delete")}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
