import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const BASE =
  "rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-faint transition-colors focus:border-brand disabled:cursor-not-allowed disabled:opacity-50";

/** Variante dense (lignes de tableau…) : padding et rayon réduits. */
const COMPACT =
  "rounded-lg border border-line bg-card px-2 py-1 text-sm text-ink placeholder:text-faint transition-colors focus:border-brand disabled:cursor-not-allowed disabled:opacity-50";

export function TextInput({
  className = "",
  compact = false,
  widthClass = "w-full",
  type,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { compact?: boolean; widthClass?: string }) {
  return <input type={type} className={`${compact ? COMPACT : BASE} ${widthClass} ${className}`} {...props} />;
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${BASE} w-full ${className}`} {...props} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${BASE} ${className}`} {...props} />;
}

/** Input numérique avec suffixe d'unité (ex. "min"). */
export function NumberInput({
  unit,
  className = "",
  compact = false,
  wide = false,
  type: _type,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { unit?: string; compact?: boolean; wide?: boolean }) {
  void _type;
  const base = compact ? COMPACT : BASE;
  if (!unit) return <input type="number" className={`${base} ${className}`} {...props} />;
  const width = wide ? "w-24" : compact ? "w-14" : "w-20";
  return (
    <span className="inline-flex items-center gap-1">
      <input type="number" className={`${base} ${width} ${className}`} {...props} />
      <span className="text-sm text-mist">{unit}</span>
    </span>
  );
}

export function Checkbox({ className = "", type: _type, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  void _type;
  return (
    <input
      type="checkbox"
      className={`h-4 w-4 accent-brand disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    />
  );
}

/** Interrupteur pour les booléens (ex. pages publiques). */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? "bg-brand" : "bg-line"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-all ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
      <span>{label}</span>
    </label>
  );
}
