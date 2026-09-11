import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const BASE =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${BASE} w-full ${props.className ?? ""}`} {...props} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${BASE} w-full ${props.className ?? ""}`} {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${BASE} ${props.className ?? ""}`} {...props} />;
}

/** Input numérique avec suffixe d'unité (ex. "min"). */
export function NumberInput({
  unit,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { unit?: string }) {
  if (!unit) return <input type="number" className={BASE} {...props} />;
  return (
    <span className="inline-flex items-center gap-1">
      <input type="number" className={`${BASE} w-20`} {...props} />
      <span className="text-sm text-zinc-500">{unit}</span>
    </span>
  );
}

export function Checkbox(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="checkbox" className="h-4 w-4 accent-zinc-900 dark:accent-zinc-100" {...props} />;
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
          checked ? "bg-zinc-900 dark:bg-zinc-100" : "bg-zinc-300 dark:bg-zinc-700"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all dark:bg-zinc-900 ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
      <span>{label}</span>
    </label>
  );
}
