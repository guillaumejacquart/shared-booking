"use client";

import { useState } from "react";

import { t } from "@/lib/i18n";
import { Button, Field, FormMessage, Select, TextInput } from "@/components/ui";
import type { Opening } from "./exceptions-api";

/** Horaires + salle d'une ouverture exceptionnelle sur les jours sélectionnés. */
export default function OpeningForm({
  rooms,
  initial,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  rooms: { id: string; name: string }[];
  initial: Opening;
  busy: boolean;
  error: string | null;
  onSubmit: (opening: Opening) => void;
  onCancel: () => void;
}) {
  const [opening, setOpening] = useState<Opening>(initial);

  return (
    <div>
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
      <FormMessage tone="error">{error ?? ""}</FormMessage>
    </div>
  );
}
