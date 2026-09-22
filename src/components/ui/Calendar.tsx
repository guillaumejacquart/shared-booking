"use client";

import { useState } from "react";

import { WEEKDAY_SHORT, monthCells, monthLabel } from "@/lib/calendar";

/**
 * Grille calendaire mensuelle (lundi-dimanche).
 * - `availableDays` : jours cliquables (les autres sont grisés).
 * - `renderDay` : contenu additionnel sous le numéro (pastilles…).
 * - `onSelect` : ne se déclenche que sur un jour disponible.
 */
export default function Calendar({
  initialMonth,
  selected,
  availableDays,
  onSelect,
  renderDay,
}: {
  initialMonth: Date;
  selected?: string | null;
  availableDays?: Set<string>;
  onSelect?: (dateKey: string) => void;
  renderDay?: (dateKey: string) => React.ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  const base = new Date(initialMonth.getTime());
  base.setMonth(base.getMonth() + offset);
  const year = base.getFullYear();
  const monthIndex = base.getMonth();
  const cells = monthCells(year, monthIndex);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setOffset((o) => o - 1)}
          className="rounded-full border border-line bg-card px-3 py-1 text-sm transition-colors hover:bg-wash"
          aria-label="Mois précédent"
        >
          ←
        </button>
        <p className="font-display font-medium capitalize">{monthLabel(year, monthIndex)}</p>
        <button
          type="button"
          onClick={() => setOffset((o) => o + 1)}
          className="rounded-full border border-line bg-card px-3 py-1 text-sm transition-colors hover:bg-wash"
          aria-label="Mois suivant"
        >
          →
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-mist">
        {WEEKDAY_SHORT.map((d) => (
          <span key={d} className="py-1">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c) => {
          const available = !availableDays || availableDays.has(c.key);
          const isSelected = selected === c.key;
          return (
            <button
              key={c.key}
              type="button"
              disabled={!c.inMonth || !available}
              onClick={() => onSelect?.(c.key)}
              className={`flex min-h-11 flex-col items-center justify-center rounded-xl px-1 py-1 text-sm transition-colors ${
                !c.inMonth
                  ? "invisible"
                  : isSelected
                    ? "bg-brand font-semibold text-brand-ink shadow-soft"
                    : available
                      ? "hover:bg-wash"
                      : "text-faint"
              }`}
            >
              <span>{c.date.getUTCDate()}</span>
              {c.inMonth && renderDay ? renderDay(c.key) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
