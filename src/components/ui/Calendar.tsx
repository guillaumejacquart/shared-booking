"use client";

import { useMemo, useState } from "react";

import { WEEKDAY_SHORT, monthCells, monthLabel, toKey } from "@/lib/calendar";

/**
 * Grille calendaire mensuelle (lundi-dimanche).
 * - `availableDays` : jours cliquables (les autres sont grisés).
 * - `renderDay` : contenu additionnel sous le numéro (pastilles…).
 * - `onSelect` : ne se déclenche que sur un jour disponible.
 * - `minOffset` / `maxOffset` : bornes de navigation (mois relatifs).
 */
export default function Calendar({
  initialMonth,
  selected,
  availableDays,
  onSelect,
  renderDay,
  minOffset = -12,
  maxOffset = 12,
}: {
  initialMonth: Date;
  selected?: string | null;
  availableDays?: Set<string>;
  onSelect?: (dateKey: string) => void;
  renderDay?: (dateKey: string) => React.ReactNode;
  minOffset?: number;
  maxOffset?: number;
}) {
  const [offset, setOffset] = useState(0);
  const base = new Date(initialMonth.getTime());
  base.setMonth(base.getMonth() + offset);
  const year = base.getFullYear();
  const monthIndex = base.getMonth();
  const cells = useMemo(() => monthCells(year, monthIndex), [year, monthIndex]);
  const atMin = offset <= minOffset;
  const atMax = offset >= maxOffset;
  const todayKey = useMemo(() => toKey(new Date()), []);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setOffset((o) => Math.max(o - 1, minOffset))}
          disabled={atMin}
          aria-disabled={atMin}
          aria-label="Mois précédent"
          className="rounded-full border border-line bg-card px-3 py-1 text-sm transition-colors hover:bg-wash disabled:cursor-not-allowed disabled:opacity-50"
        >
          ←
        </button>
        <p className="font-display font-medium capitalize">{monthLabel(year, monthIndex)}</p>
        <button
          type="button"
          onClick={() => setOffset((o) => Math.min(o + 1, maxOffset))}
          disabled={atMax}
          aria-disabled={atMax}
          aria-label="Mois suivant"
          className="rounded-full border border-line bg-card px-3 py-1 text-sm transition-colors hover:bg-wash disabled:cursor-not-allowed disabled:opacity-50"
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
              aria-pressed={isSelected}
              aria-current={c.key === todayKey ? "date" : undefined}
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
