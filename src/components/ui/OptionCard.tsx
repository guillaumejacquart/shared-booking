import type { ButtonHTMLAttributes } from "react";

/** Carte cliquable d'un choix exclusif (liste d'options). */
export default function OptionCard({
  selected,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`rounded-2xl border p-3 text-left transition-all duration-200 ${
        selected ? "border-brand bg-brand-soft shadow-soft" : "border-line bg-card hover:border-brand"
      } ${className}`}
      {...props}
    />
  );
}
