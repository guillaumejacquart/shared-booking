/** Pastille de statut (tons sémantiques du design system). */
type Tone = "green" | "red" | "zinc" | "amber" | "blue";

const TONES: Record<Tone, string> = {
  green: "bg-ok-bg text-ok",
  red: "bg-danger-bg text-danger",
  zinc: "bg-wash text-mist",
  amber: "bg-warn-bg text-warn",
  blue: "bg-brand-soft text-brand-deep",
};

export default function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}
