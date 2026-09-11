"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { t } from "@/lib/i18n";
import { Button, Checkbox, Field, FormMessage, TextInput } from "@/components/ui";

export interface RoomRow {
  id: string;
  name: string;
  color: string;
  practitionerIds: string[];
}

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
  const [color, setColor] = useState("#3b82f6");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(`/api/offices/${officeId}/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color, practitionerIds: [] }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError((j?.error as string) || t("booking.errorGeneric"));
      return;
    }
    // Mise à jour optimiste : l'état local fait foi (les props `initial`
    // ne sont lues qu'au premier rendu, `router.refresh()` seul ne suffit pas).
    const created = (await res.json()) as { id: string };
    setDrafts((rs) => [...rs, { id: created.id, name, color, practitionerIds: [] }]);
    setName("");
    router.refresh();
  }

  async function save(room: RoomRow) {
    setError(null);
    const res = await fetch(`/api/offices/${officeId}/rooms/${room.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: room.name, color: room.color, practitionerIds: room.practitionerIds }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError((j?.error as string) || t("booking.errorGeneric"));
      return;
    }
    setSaved(true);
    router.refresh();
  }

  async function remove(id: string) {
    setError(null);
    const res = await fetch(`/api/offices/${officeId}/rooms/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError((j?.error as string) || t("rooms.inUse"));
      return;
    }
    setDrafts((rs) => rs.filter((r) => r.id !== id));
    router.refresh();
  }

  function patch(id: string, data: Partial<RoomRow>) {
    setSaved(false);
    setDrafts((rs) => rs.map((r) => (r.id === id ? { ...r, ...data } : r)));
  }
  function toggle(room: RoomRow, practitionerId: string) {
    const has = room.practitionerIds.includes(practitionerId);
    patch(room.id, {
      practitionerIds: has
        ? room.practitionerIds.filter((p) => p !== practitionerId)
        : [...room.practitionerIds, practitionerId],
    });
  }

  return (
    <div>
      <div className="grid gap-3">
        {drafts.map((r) => (
          <div key={r.id} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex flex-wrap items-end gap-2">
              <span
                className="mb-2 inline-block h-4 w-4 shrink-0 rounded-full"
                style={{ backgroundColor: r.color }}
              />
              <Field label={t("rooms.name")}>
                <TextInput value={r.name} onChange={(e) => patch(r.id, { name: e.target.value })} maxLength={60} />
              </Field>
              <Field label={t("rooms.color")}>
                <input
                  type="color"
                  value={r.color}
                  onChange={(e) => patch(r.id, { color: e.target.value })}
                  className="h-9 w-14 cursor-pointer rounded-lg border border-zinc-300 dark:border-zinc-700"
                  aria-label={t("rooms.color")}
                />
              </Field>
              <Button size="sm" onClick={() => void save(r)}>
                {t("sessionTypesAdmin.save")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void remove(r.id)}>
                {t("rooms.delete")}
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              {practitioners.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-1.5">
                  <Checkbox
                    checked={r.practitionerIds.includes(p.id)}
                    onChange={() => toggle(r, p.id)}
                  />
                  {p.displayName}
                </label>
              ))}
            </div>
            {r.practitionerIds.length === 0 ? (
              <p className="mt-2 text-xs text-zinc-500">{t("rooms.allowed")}</p>
            ) : null}
          </div>
        ))}
      </div>
      <form onSubmit={create} className="mt-4 flex flex-wrap items-end gap-2">
        <Field label={t("rooms.name")}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
        </Field>
        <Field label={t("rooms.color")}>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-9 w-14 cursor-pointer rounded-lg border border-zinc-300 dark:border-zinc-700"
            aria-label={t("rooms.color")}
          />
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
