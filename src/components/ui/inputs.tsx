import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const BASE =
  "rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-faint transition-colors focus:border-brand disabled:cursor-not-allowed disabled:opacity-50";

export function TextInput({ className = "", type, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type={type} className={`${BASE} w-full ${className}`} {...props} />;
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
  type: _type,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { unit?: string }) {
  void _type;
  if (!unit)
    return <input type="number" className={`${BASE} ${className}`} {...props} />;
  return (
    <span className="inline-flex items-center gap-1">
      <input type="number" className={`${BASE} w-20 ${className}`} {...props} />
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
