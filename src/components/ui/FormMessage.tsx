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
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`text-sm ${tone === "ok" ? "text-ok" : "text-danger"}`}
    >
      {children}
    </p>
  );
}
