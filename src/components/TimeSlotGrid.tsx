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
          className={`rounded-full border px-2 py-2 text-sm font-medium transition-all duration-200 ${
            selected === startAt
              ? "border-brand bg-brand text-brand-ink shadow-soft"
              : "border-line bg-card hover:border-brand hover:bg-brand-soft"
          }`}
        >
          {timeFmt.format(new Date(startAt))}
        </button>
      ))}
    </div>
  );
}
