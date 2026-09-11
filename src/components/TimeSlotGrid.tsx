"use client";

import { timeFmt } from "@/lib/format";

/** Grille de créneaux horaires (widget public + report). */
export default function TimeSlotGrid({
  slots,
  selected,
  onSelect,
}: {
  slots: string[]; // ISO UTC
  selected: string;
  onSelect: (startAt: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {slots.map((startAt) => (
        <button
          key={startAt}
          type="button"
          onClick={() => onSelect(startAt)}
          aria-pressed={selected === startAt}
          className={`rounded-lg border px-2 py-2 text-sm font-medium transition-colors ${
            selected === startAt
              ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
              : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800"
          }`}
        >
          {timeFmt.format(new Date(startAt))}
        </button>
      ))}
    </div>
  );
}
