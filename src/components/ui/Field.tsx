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
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && !error ? <span className="text-xs text-mist">{hint}</span> : null}
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </label>
  );
}
