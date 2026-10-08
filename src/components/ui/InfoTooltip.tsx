/**
 * Icône ⓘ avec infobulle au survol et au clavier (focus).
 * Préférée au `title` natif : affichage immédiat et style homogène.
 */
export default function InfoTooltip({
  text,
  align = "center",
}: {
  text: string;
  /** `right` : bulle calée à droite (champ en bord de carte, mobile). */
  align?: "center" | "right";
}) {
  return (
    <span className="group relative inline-flex shrink-0" tabIndex={0} aria-label={text}>
      <span aria-hidden="true" className="cursor-help leading-none text-mist">
        ⓘ
      </span>
      <span
        role="tooltip"
        className={`pointer-events-none absolute bottom-full z-10 mb-2 w-56 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-card px-3 py-2 text-xs font-normal text-ink opacity-0 shadow-soft transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${
          align === "right" ? "right-0" : "left-1/2 -translate-x-1/2"
        }`}
      >
        {text}
      </span>
    </span>
  );
}
