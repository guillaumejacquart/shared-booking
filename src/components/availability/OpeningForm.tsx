"use client";

import { useState } from "react";

import { t } from "@/lib/i18n";
import { Button, Field, FormMessage, Select, TextInput } from "@/components/ui";
import type { Opening } from "./exceptions-api";
import { slotAfter } from "./exceptions-api";

/** Un ou plusieurs créneaux d'ouverture exceptionnelle (horaires + salle chacun). */
export default function OpeningForm({
  rooms,
  initial,
  busy,
  error,
  submitLabel,
  showRooms = true,
  note,
  onSubmit,
  onCancel,
}: {
  rooms: { id: string; name: string }[];
  initial: Opening[];
  busy: boolean;
  error: string | null;
  submitLabel?: string;
  /** Jours réguliers : pas de salle (attribuée automatiquement à la réservation). */
  showRooms?: boolean;
  note?: string;
  onSubmit: (openings: Opening[]) => void;
  onCancel: () => void;
}) {
  const [openings, setOpenings] = useState<Opening[]>(
    initial.length > 0 ? initial : [{ startTime: "09:00", endTime: "12:00", roomId: "" }],
  );

  function patch(index: number, data: Partial<Opening>) {
    setOpenings((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...data } : row)));
  }

  function addSlot() {
    setOpenings((rows) => {
      const last = rows[rows.length - 1];
      const fallback: Opening = { startTime: "09:00", endTime: "12:00", roomId: rooms[0]?.id ?? "" };
      return [...rows, last ? slotAfter(last) : fallback];
    });
  }

  function removeSlot(index: number) {
    setOpenings((rows) => [...rows.slice(0, index), ...rows.slice(index + 1)]);
  }

  return (
    <div>
      {showRooms && rooms.length === 0 ? (
        <FormMessage tone="error">{t("availability.needRoom")}</FormMessage>
      ) : (
        <div className="flex flex-col gap-2">
          {note ? <p className="text-xs text-mist">{note}</p> : null}
          <ul className="flex flex-col gap-2">
            {openings.map((opening, index) => (
              <li key={index} className="flex flex-wrap items-end gap-2">
                <Field label="Début">
                  <TextInput
                    type="time"
                    value={opening.startTime}
                    onChange={(event) => patch(index, { startTime: event.target.value })}
                    required
                  />
                </Field>
                <Field label="Fin">
                  <TextInput
                    type="time"
                    value={opening.endTime}
                    onChange={(event) => patch(index, { endTime: event.target.value })}
                    required
                  />
                </Field>
                {showRooms ? (
                  <Field label={t("availability.room")}>
                    <Select value={opening.roomId} onChange={(event) => patch(index, { roomId: event.target.value })}>
                      {rooms.map((room) => (
                        <option key={room.id} value={room.id}>
                          {room.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
                {openings.length > 1 ? (
                  <Button size="sm" variant="ghost" onClick={() => removeSlot(index)}>
                    {t("availability.delete")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          <div>
            <Button size="sm" variant="ghost" onClick={addSlot}>
              {t("availability.addSlot")}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => onSubmit(openings)}>
              {submitLabel ?? t("availability.createOpening")}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              {t("availability.cancel")}
            </Button>
          </div>
        </div>
      )}
      <FormMessage tone="error">{error ?? ""}</FormMessage>
    </div>
  );
}
