"use client";

import { t } from "@/lib/i18n";
import { Calendar } from "@/components/ui";
import TimeSlotGrid from "@/components/TimeSlotGrid";

/**
 * Sélecteur de créneau : calendrier + grille horaire + états.
 * Combine Calendar et TimeSlotGrid (widget public + report).
 */
export default function SlotPicker({
  availableDays,
  day,
  slots,
  selected,
  loading,
  onSelectDay,
  onSelectSlot,
  timeZone = "Europe/Paris",
  fullLabel,
}: {
  availableDays: Set<string>;
  day: string | null;
  slots: string[];
  selected: string;
  loading: boolean;
  onSelectDay: (key: string) => void;
  onSelectSlot: (s: string) => void;
  timeZone?: string;
  fullLabel?: string | null;
}) {
  if (loading) {
    return <p className="text-sm text-mist">{t("booking.loading")}</p>;
  }
  if (availableDays.size === 0) {
    return <p className="text-sm text-mist">{fullLabel ?? t("booking.full")}</p>;
  }
  return (
    <>
      <Calendar
        initialMonth={new Date()}
        selected={day}
        availableDays={availableDays}
        onSelect={onSelectDay}
        renderDay={(key) =>
          availableDays.has(key) && key !== day ? (
            <span className="h-1 w-1 rounded-full bg-brand" />
          ) : null
        }
      />
      {day ? (
        <div className="mt-3">
          <TimeSlotGrid
            slots={slots}
            selected={selected}
            onSelect={onSelectSlot}
            timeZone={timeZone}
            emptyLabel={t("booking.noSlots")}
          />
        </div>
      ) : (
        <p className="mt-3 text-sm text-mist">{t("booking.selectDay")}</p>
      )}
    </>
  );
}
