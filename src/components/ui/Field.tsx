import { cloneElement, isValidElement, useId } from "react";

/**
 * Champ de formulaire : label + contrôle + aide/erreur.
 * Garantit que chaque input a un vrai label (accessibilité + clarté).
 */
export default function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  // Identifiant stable : htmlFor explicite prioritaire, sinon généré.
  const generated = useId();
  const id = htmlFor ?? generated;
  const hintId = hint && !error ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  // Propage l'id au contrôle enfant s'il n'en a pas déjà un.
  let control = children;
  if (isValidElement<{ id?: string; "aria-describedby"?: string }>(children)) {
    const props = children.props as { id?: string; "aria-describedby"?: string };
    if (props.id == null) {
      control = cloneElement(children, {
        id,
        ...(describedBy && props["aria-describedby"] == null
          ? { "aria-describedby": describedBy }
          : null),
      });
    } else if (describedBy && props["aria-describedby"] == null) {
      control = cloneElement(children, { "aria-describedby": describedBy });
    }
  }

  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {control}
      {hint && !error ? (
        <span id={hintId} className="text-xs text-mist">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}
