import type { ButtonHTMLAttributes } from "react";

/**
 * Bouton du design system. `primary` = action principale (teinte de marque),
 * `secondary` = action secondaire (carte + contour doux), `danger` =
 * destructif (ton doux, jamais agressif), `ghost` = discret.
 */
type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-brand text-brand-ink shadow-soft hover:bg-brand-deep hover:shadow-lift",
  secondary:
    "border border-line bg-card text-ink hover:bg-wash",
  danger: "bg-danger-bg text-danger hover:bg-danger hover:text-white",
  ghost: "text-mist hover:bg-wash hover:text-ink",
};

const SIZES: Record<Size, string> = {
  sm: "px-3 py-1 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-3 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export default function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`rounded-full font-medium transition-all duration-200 disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    />
  );
}
