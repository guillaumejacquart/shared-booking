"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { t } from "@/lib/i18n";
import { sendJson } from "@/lib/api-client";
import { Button, Checkbox, ColorPicker, Field, FormMessage, TextInput } from "@/components/ui";

export interface RoomRow {
  id: string;
  name: string;
  color: string;
  practitionerIds: string[];
}

/** Couleurs de salle proposées (tons sourds, lisibles sur fond clair). */
const ROOM_COLORS = [
  "#4e7a5b",
  "#3f6e85",
  "#6a5fa0",
  "#96603a",
  "#9e5f74",
  "#4f7d6a",
  "#7a5c8f",
  "#6b7a5e",
];

const DEFAULT_ROOM_COLOR = ROOM_COLORS[0];

export default function RoomsManager({
  officeId,
  initial,
  practitioners,
}: {
  officeId: string;
  initial: RoomRow[];
  practitioners: { id: string; displayName: string }[];
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<RoomRow[]>(initial);
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_ROOM_COLOR);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const result = await sendJson<{ id: string }>(`/api/offices/${officeId}/rooms`, "POST", {
      name,
      color,
      practitionerIds: [],
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Mise à jour optimiste : `initial` n'est lu qu'au premier rendu.
    setDrafts((prev) => [...prev, { id: result.data.id, name, color, practitionerIds: [] }]);
    setName("");
    router.refresh();
  }

  async function save(room: RoomRow) {
    setError(null);
    const result = await sendJson(`/api/offices/${officeId}/rooms/${room.id}`, "PATCH", {
      name: room.name,
      color: room.color,
      practitionerIds: room.practitionerIds,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  async function remove(id: string) {
    setError(null);
    const res = await fetch(`/api/offices/${officeId}/rooms/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError((body?.error as string) || t("rooms.inUse"));
      return;
    }
    setDrafts((prev) => prev.filter((room) => room.id !== id));
    router.refresh();
  }

  function patch(id: string, data: Partial<RoomRow>) {
    setSaved(false);
    setDrafts((prev) => prev.map((room) => (room.id === id ? { ...room, ...data } : room)));
  }
  function toggle(room: RoomRow, practitionerId: string) {
    const has = room.practitionerIds.includes(practitionerId);
    patch(room.id, {
      practitionerIds: has
        ? room.practitionerIds.filter((id) => id !== practitionerId)
        : [...room.practitionerIds, practitionerId],
    });
  }

  return (
    <div>
      <div className="grid gap-3">
        {drafts.map((room) => (
          <div key={room.id} className="rounded-2xl border border-line bg-card p-4 shadow-soft">
            <div className="flex flex-wrap items-end gap-2">
              <span
                className="mb-2 inline-block h-4 w-4 shrink-0 rounded-full"
                style={{ backgroundColor: room.color }}
              />
              <Field label={t("rooms.name")}>
                <TextInput value={room.name} onChange={(event) => patch(room.id, { name: event.target.value })} maxLength={60} />
              </Field>
              <Field label={t("rooms.color")}>
                <ColorPicker
                  value={room.color}
                  presets={ROOM_COLORS}
                  onChange={(nextColor) => patch(room.id, { color: nextColor })}
                  label={t("rooms.color")}
                />
              </Field>
              <Button size="sm" onClick={() => void save(room)}>
                {t("sessionTypesAdmin.save")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void remove(room.id)}>
                {t("rooms.delete")}
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              {practitioners.map((prac) => (
                <label key={prac.id} className="flex cursor-pointer items-center gap-1.5">
                  <Checkbox
                    checked={room.practitionerIds.includes(prac.id)}
                    onChange={() => toggle(room, prac.id)}
                  />
                  {prac.displayName}
                </label>
              ))}
            </div>
            {room.practitionerIds.length === 0 ? (
              <p className="mt-2 text-xs text-mist">{t("rooms.allowed")}</p>
            ) : null}
          </div>
        ))}
      </div>
      <form onSubmit={create} className="mt-4 flex flex-wrap items-end gap-2">
        <Field label={t("rooms.name")}>
          <TextInput value={name} onChange={(event) => setName(event.target.value)} required maxLength={60} />
        </Field>
        <Field label={t("rooms.color")}>
          <ColorPicker value={color} presets={ROOM_COLORS} onChange={setColor} label={t("rooms.color")} />
        </Field>
        <Button type="submit">{t("rooms.create")}</Button>
      </form>
      <div className="mt-2 flex flex-col gap-1">
        <FormMessage tone="error">{error ?? ""}</FormMessage>
        {saved ? <FormMessage tone="ok">{t("dashboard.saved")}</FormMessage> : null}
      </div>
    </div>
  );
}
