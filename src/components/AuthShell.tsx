import Link from "next/link";

/**
 * Coquille des pages d'authentification (login, signup, mot de passe,
 * invitation, onboarding) : toujours claire en palette sauge, quel que soit
 * le mode de l'appareil — même pattern que la landing. Sans ça, `data-mode`
 * hérité du layout (`system`) bascule ces pages en vert très sombre
 * (#141b16) sur les appareils en dark mode.
 */
export default function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-palette="sauge"
      data-mode="light"
      className="flex min-h-full flex-1 flex-col bg-wash text-ink"
    >
      <header className="mx-auto w-full max-w-sm px-4 pt-8">
        <Link
          href="/"
          className="font-display text-lg font-semibold tracking-tight"
        >
          Le Cabinet Partagé
        </Link>
      </header>
      <main className="mx-auto grid w-full max-w-sm flex-1 place-items-center px-4 py-10">
        <div className="w-full rounded-3xl bg-card p-8 shadow-lift">
          {children}
        </div>
      </main>
    </div>
  );
}
