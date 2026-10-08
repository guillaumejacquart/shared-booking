"use client";

import { useState } from "react";

import { t } from "@/lib/i18n";
import { Button, Field, FormMessage, TextInput } from "@/components/ui";

export interface DayHours {
  startTime: string;
  endTime: string;
}

/** Change les horaires d'un jour ouvert (rogne les plages habituelles). */
export default function DayHoursForm({
  habitual,
  initial,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  habitual: string;
  initial: DayHours;
  busy: boolean;
  error: string | null;
  onSubmit: (hours: DayHours) => void;
  onCancel: () => void;
}) {
  const [hours, setHours] = useState<DayHours>(initial);

  return (
    <div>
      <p className="mb-2 text-xs text-mist">{t("availability.hoursHabitual", { ranges: habitual })}</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Début">
          <TextInput
            type="time"
            value={hours.startTime}
            onChange={(event) => setHours({ ...hours, startTime: event.target.value })}
            required
          />
        </Field>
        <Field label="Fin">
          <TextInput
            type="time"
            value={hours.endTime}
            onChange={(event) => setHours({ ...hours, endTime: event.target.value })}
            required
          />
        </Field>
        <Button size="sm" disabled={busy} onClick={() => onSubmit(hours)}>
          {t("availability.hoursApply")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("availability.cancel")}
        </Button>
      </div>
      <FormMessage tone="error">{error ?? ""}</FormMessage>
    </div>
  );
}
