"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { t } from "@/lib/i18n";
import { sendJson } from "@/lib/api-client";
import { slotAfter } from "@/components/availability/exceptions-api";
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

interface ExtraSlot {
  startTime: string;
  endTime: string;
  roomId: string;
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
  // Une ouverture exceptionnelle peut comporter plusieurs créneaux.
  const [extraSlots, setExtraSlots] = useState<ExtraSlot[]>([
    { startTime: "09:00", endTime: "12:00", roomId: rooms[0]?.id ?? "" },
  ]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Édition inline d'une ouverture (supprimée puis recréée à l'enregistrement).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStart, setEditStart] = useState("09:00");
  const [editEnd, setEditEnd] = useState("12:00");
  const [editRoomId, setEditRoomId] = useState("");
  const [editReason, setEditReason] = useState("");

  function patchSlot(index: number, data: Partial<ExtraSlot>) {
    setExtraSlots((slots) => slots.map((slot, slotIndex) => (slotIndex === index ? { ...slot, ...data } : slot)));
  }

  function addSlot() {
    setExtraSlots((slots) => {
      const last = slots[slots.length - 1];
      const fallback: ExtraSlot = { startTime: "09:00", endTime: "12:00", roomId: rooms[0]?.id ?? "" };
      return [...slots, last ? slotAfter(last) : fallback];
    });
  }

  function removeSlot(index: number) {
    setExtraSlots((slots) => [...slots.slice(0, index), ...slots.slice(index + 1)]);
  }

  function roomName(roomId: string | null): string {
    if (!roomId) return "";
    return rooms.find((room) => room.id === roomId)?.name ?? "";
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (kind === "extra") {
        for (const slot of extraSlots) {
          const result = await sendJson("/api/exceptions", "POST", {
            practitionerId,
            date,
            kind,
            fullDay: false,
            startTime: slot.startTime,
            endTime: slot.endTime,
            roomId: slot.roomId || undefined,
            reason: reason || undefined,
          });
          if (!result.ok) throw new Error(result.error);
        }
      } else {
        const result = await sendJson("/api/exceptions", "POST", {
          practitionerId,
          date,
          kind,
          fullDay,
          startTime: fullDay ? undefined : startTime,
          endTime: fullDay ? undefined : endTime,
          reason: reason || undefined,
        });
        if (!result.ok) throw new Error(result.error);
      }
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

  function startEdit(exception: ExceptionRow) {
    setEditingId(exception.id);
    setEditStart(exception.startTime ?? "09:00");
    setEditEnd(exception.endTime ?? "12:00");
    setEditRoomId(exception.roomId ?? rooms[0]?.id ?? "");
    setEditReason(exception.reason ?? "");
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(exception: ExceptionRow) {
    setError(null);
    setBusy(true);
    try {
      const deleted = await fetch(`/api/exceptions/${exception.id}?practitionerId=${practitionerId}`, {
        method: "DELETE",
      });
      if (!deleted.ok) throw new Error(t("booking.errorGeneric"));
      const result = await sendJson("/api/exceptions", "POST", {
        practitionerId,
        date: exception.date,
        kind: "extra",
        fullDay: false,
        startTime: editStart,
        endTime: editEnd,
        roomId: editRoomId || undefined,
        reason: editReason || undefined,
      });
      if (!result.ok) throw new Error(result.error);
      setEditingId(null);
      notifyAvailabilitiesChanged();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("booking.errorGeneric"));
    } finally {
      setBusy(false);
    }
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
        {kind === "off" && !fullDay ? (
          <>
            <Field label="Début">
              <TextInput type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} required />
            </Field>
            <Field label="Fin">
              <TextInput type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} required />
            </Field>
          </>
        ) : null}
        <Field label={t("availability.reason")}>
          <TextInput value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} />
        </Field>
        <Button type="submit" disabled={busy}>
          {t("availability.add")}
        </Button>
      </form>
      {kind === "extra" ? (
        <div className="mt-2 flex flex-col gap-2">
          {rooms.length === 0 ? (
            <FormMessage tone="error">{t("availability.needRoom")}</FormMessage>
          ) : (
            <ul className="flex flex-col gap-2">
              {extraSlots.map((slot, index) => (
                <li key={index} className="flex flex-wrap items-end gap-2">
                  <Field label="Début">
                    <TextInput
                      type="time"
                      value={slot.startTime}
                      onChange={(event) => patchSlot(index, { startTime: event.target.value })}
                      required
                    />
                  </Field>
                  <Field label="Fin">
                    <TextInput
                      type="time"
                      value={slot.endTime}
                      onChange={(event) => patchSlot(index, { endTime: event.target.value })}
                      required
                    />
                  </Field>
                  <Field label={t("availability.room")}>
                    <Select value={slot.roomId} onChange={(event) => patchSlot(index, { roomId: event.target.value })}>
                      {rooms.map((room) => (
                        <option key={room.id} value={room.id}>
                          {room.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {extraSlots.length > 1 ? (
                    <Button size="sm" variant="ghost" onClick={() => removeSlot(index)}>
                      {t("availability.delete")}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {rooms.length > 0 ? (
            <div>
              <Button size="sm" variant="ghost" onClick={addSlot}>
                {t("availability.addSlot")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <FormMessage tone="error">{error ?? ""}</FormMessage>
      <ul className="mt-3 grid gap-2">
        {initial.map((exception) => (
          <li
            key={exception.id}
            className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-card p-2 text-sm shadow-soft"
          >
            {editingId === exception.id ? (
              <>
                <span className="font-medium">{exception.date}</span>
                <Field label="Début">
                  <TextInput type="time" value={editStart} onChange={(event) => setEditStart(event.target.value)} required />
                </Field>
                <Field label="Fin">
                  <TextInput type="time" value={editEnd} onChange={(event) => setEditEnd(event.target.value)} required />
                </Field>
                <Field label={t("availability.room")}>
                  <Select value={editRoomId} onChange={(event) => setEditRoomId(event.target.value)}>
                    {rooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("availability.reason")}>
                  <TextInput
                    value={editReason}
                    onChange={(event) => setEditReason(event.target.value)}
                    maxLength={200}
                  />
                </Field>
                <Button size="sm" disabled={busy} onClick={() => void saveEdit(exception)}>
                  {t("availability.hoursApply")}
                </Button>
                <Button size="sm" variant="ghost" onClick={cancelEdit}>
                  {t("availability.cancel")}
                </Button>
              </>
            ) : (
              <>
                <span className="font-medium">{exception.date}</span>
                <span className="text-mist">
                  {exception.kind === "off" ? t("availability.dayOff") : t("availability.extra")}
                  {exception.fullDay ? "" : ` ${exception.startTime}→${exception.endTime}`}
                  {exception.kind === "extra" && exception.roomId ? ` · ${roomName(exception.roomId)}` : ""}
                  {exception.reason ? ` · ${exception.reason}` : ""}
                </span>
                {exception.kind === "extra" ? (
                  <Button size="sm" variant="ghost" onClick={() => startEdit(exception)}>
                    {t("availability.edit")}
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => void remove(exception.id)} className="ml-auto">
                  {t("availability.delete")}
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
