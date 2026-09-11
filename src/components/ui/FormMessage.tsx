/** Message inline de formulaire (succès / erreur). */
export default function FormMessage({
  tone,
  children,
}: {
  tone: "ok" | "error";
  children: React.ReactNode;
}) {
  if (!children) return null;
  return (
    <p className={`text-sm ${tone === "ok" ? "text-green-700 dark:text-green-300" : "text-red-600"}`}>
      {children}
    </p>
  );
}
