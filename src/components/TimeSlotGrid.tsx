"use client";

import { useMemo } from "react";

/** Formateur d'heure mis en cache par fuseau (évite de recréer à chaque render). */
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function timeFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = fmtCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("fr-FR", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
    });
    fmtCache.set(timeZone, fmt);
  }
  return fmt;
}

/** Grille de créneaux horaires (widget public + report). */
export default function TimeSlotGrid({
  slots,
  selected,
  onSelect,
  timeZone = "Europe/Paris",
  emptyLabel,
  legend,
}: {
  slots: string[]; // ISO UTC
  selected: string;
  onSelect: (startAt: string) => void;
  timeZone?: string;
  emptyLabel?: string;
  legend?: string;
}) {
  const fmt = useMemo(() => timeFormatter(timeZone), [timeZone]);

  if (slots.length === 0) {
    if (!emptyLabel) return null;
    return <p className="text-sm text-mist">{emptyLabel}</p>;
  }

  return (
    <fieldset>
      <legend className="sr-only">{legend ?? "Créneaux horaires disponibles"}</legend>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {slots.map((startAt) => (
          <button
            key={startAt}
            type="button"
            onClick={() => onSelect(startAt)}
            aria-pressed={selected === startAt}
            className={`rounded-full border px-2 py-2 text-sm font-medium transition-all duration-200 ${
              selected === startAt
                ? "border-brand bg-brand text-brand-ink shadow-soft"
                : "border-line bg-card hover:border-brand hover:bg-brand-soft"
            }`}
          >
            {fmt.format(new Date(startAt))}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
