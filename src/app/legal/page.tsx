import Link from "next/link";
import type { Metadata } from "next";

import { STR } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Mentions légales & CGV — Le Cabinet Partagé",
  description:
    "Éditeur, hébergement, abonnement des cabinets, paiement des séances et données personnelles.",
};

const copy = STR.legal;

const sections: { title: string; text: string }[] = [
  { title: copy.editorTitle, text: copy.editor },
  { title: copy.hostingTitle, text: copy.hosting },
  { title: copy.serviceTitle, text: copy.service },
  { title: copy.subscriptionTitle, text: copy.subscription },
  { title: copy.sessionsTitle, text: copy.sessions },
  { title: copy.privacyTitle, text: copy.privacy },
  { title: copy.analyticsTitle, text: copy.analytics },
  { title: copy.lawTitle, text: copy.law },
];

/** Page publique : mentions légales, CGV abonnement et confidentialité. */
export default function LegalPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-surface text-ink">
      <header className="border-b border-line">
        <nav className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3">
          <Link href="/" className="font-display text-lg font-semibold tracking-tight">
            Le Cabinet Partagé
          </Link>
          <Link href="/" className="text-sm text-mist transition-colors hover:text-ink">
            ← Accueil
          </Link>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">{copy.title}</h1>
        <p className="mt-2 text-sm text-mist">{copy.updated}</p>
        <div className="mt-8 space-y-8">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-xl font-semibold">{section.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-mist">{section.text}</p>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
