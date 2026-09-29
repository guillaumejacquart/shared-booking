"use client";

import { useState } from "react";

import { t } from "@/lib/i18n";
import { Button, Field, FormMessage, Select, TextInput } from "@/components/ui";
import type { Opening } from "./exceptions-api";

/** Horaires + salle d'une ouverture exceptionnelle sur les jours sélectionnés. */
export default function OpeningForm({
  dayKeys,
  rooms,
  initial,
  busy,
  onSubmit,
  onCancel,
}: {
  dayKeys: string[];
  rooms: { id: string; name: string }[];
  initial: Opening;
  busy: boolean;
  onSubmit: (opening: Opening) => void;
  onCancel: () => void;
}) {
  const [opening, setOpening] = useState<Opening>(initial);
  const first = dayKeys[0];
  const last = dayKeys[dayKeys.length - 1];

  return (
    <div className="mt-3 rounded-2xl border border-line bg-card p-3 shadow-soft">
      <p className="mb-2 text-sm font-medium">
        {t("availability.openTitle")} ·{" "}
        {dayKeys.length === 1 ? first : `${first} → ${last} (${dayKeys.length} j)`}
      </p>
      {rooms.length === 0 ? (
        <FormMessage tone="error">{t("availability.needRoom")}</FormMessage>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Début">
            <TextInput
              type="time"
              value={opening.startTime}
              onChange={(event) => setOpening({ ...opening, startTime: event.target.value })}
              required
            />
          </Field>
          <Field label="Fin">
            <TextInput
              type="time"
              value={opening.endTime}
              onChange={(event) => setOpening({ ...opening, endTime: event.target.value })}
              required
            />
          </Field>
          <Field label={t("availability.room")}>
            <Select
              value={opening.roomId}
              onChange={(event) => setOpening({ ...opening, roomId: event.target.value })}
            >
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button size="sm" disabled={busy} onClick={() => onSubmit(opening)}>
            {t("availability.createOpening")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t("availability.cancel")}
          </Button>
        </div>
      )}
    </div>
  );
}
