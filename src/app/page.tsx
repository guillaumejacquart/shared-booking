import Link from "next/link";
import type { Metadata } from "next";

import { buttonStyles } from "@/components/ui";
import { STR } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Le Cabinet Partagé — Réservation en ligne pour cabinets bien-être",
  description:
    "Chaque praticien déclare ses disponibilités, partage les salles sans conflit, et reçoit des réservations via sa page personnelle. Sans compte pour les patients.",
};

const copy = STR.landing;

export default function LandingPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-surface text-ink">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur">
        <nav className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="font-display text-lg font-semibold tracking-tight">
            Le Cabinet Partagé
          </Link>
          <div className="hidden items-center gap-6 text-sm text-mist md:flex">
            <Link href="#fonctionnalites" className="transition-colors hover:text-ink">
              {copy.featuresKicker}
            </Link>
            <Link href="#salles" className="transition-colors hover:text-ink">
              {copy.roomsKicker}
            </Link>
            <Link href="#comment" className="transition-colors hover:text-ink">
              {copy.howKicker}
            </Link>
            <Link href="#faq" className="transition-colors hover:text-ink">
              {copy.faqKicker}
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login" className={buttonStyles("ghost", "sm")}>
              {copy.footerLogin}
            </Link>
            <Link href="/signup" className={buttonStyles("primary", "sm")}>
              {copy.ctaPrimary}
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex flex-1 flex-col">
        {/* Hero */}
        <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pt-14 pb-16 md:grid-cols-2 md:pt-20 md:pb-24">
          <div>
            <p className="inline-block rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand-deep">
              {copy.badge}
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight md:text-5xl">
              {copy.title}
            </h1>
            <p className="mt-4 max-w-lg text-lg text-mist">{copy.subtitle}</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/signup" className={buttonStyles("primary", "lg")}>
                {copy.ctaPrimary}
              </Link>
              <Link href="/login" className={buttonStyles("secondary", "lg")}>
                {copy.ctaSecondary}
              </Link>
            </div>
            <p className="mt-3 text-sm text-faint">{copy.ctaNote}</p>
          </div>
          {/* Aperçu : carte de réservation publique */}
          <div
            aria-hidden="true"
            className="rounded-3xl bg-card p-6 shadow-lift md:rotate-1"
          >
            <p className="text-sm text-mist">{copy.mockOffice}</p>
            <p className="font-display mt-1 text-2xl font-semibold">
              {copy.mockPractitioner}
            </p>
            <div className="mt-4 flex gap-2">
              {["09:00", "09:55", "10:50"].map((slot) => (
                <span
                  key={slot}
                  className="rounded-full bg-brand-soft px-3 py-1 text-sm font-medium text-brand-deep"
                >
                  {slot}
                </span>
              ))}
              <span className="rounded-full bg-wash px-3 py-1 text-sm text-faint">
                11:45
              </span>
            </div>
            <div className="mt-4 space-y-2">
              <div className="h-10 rounded-xl bg-wash" />
              <div className="h-10 rounded-xl bg-wash" />
            </div>
            <div className="mt-4 rounded-full bg-brand py-2.5 text-center text-sm font-medium text-brand-ink">
              {copy.mockCta}
            </div>
          </div>
        </section>

        {/* Audiences */}
        <section className="border-y border-line bg-card">
          <div className="mx-auto w-full max-w-6xl px-4 py-10">
            <p className="text-center text-sm font-medium text-mist">
              {copy.audiencesTitle}
            </p>
            <ul className="mt-5 flex flex-wrap justify-center gap-2">
              {copy.audiences.map((audience) => (
                <li
                  key={audience}
                  className="rounded-full border border-line bg-surface px-4 py-1.5 text-sm text-mist"
                >
                  {audience}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Fonctionnalités */}
        <section id="fonctionnalites" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16 md:py-24">
          <p className="text-sm font-medium text-brand-deep">{copy.featuresKicker}</p>
          <h2 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight md:text-4xl">
            {copy.featuresTitle}
          </h2>
          <p className="mt-3 max-w-2xl text-mist">{copy.featuresSubtitle}</p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {copy.features.map((feature) => (
              <article
                key={feature.title}
                className="rounded-3xl bg-card p-6 shadow-soft transition-shadow duration-200 hover:shadow-lift"
              >
                <h3 className="text-lg font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm text-mist">{feature.text}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Salles partagées */}
        <section id="salles" className="border-y border-line bg-card">
          <div className="mx-auto grid w-full max-w-6xl scroll-mt-20 items-center gap-10 px-4 py-16 md:grid-cols-2 md:py-24">
            <div>
              <p className="text-sm font-medium text-brand-deep">{copy.roomsKicker}</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
                {copy.roomsTitle}
              </h2>
              <p className="mt-4 text-mist">{copy.roomsText}</p>
              <Link href="/signup" className={`${buttonStyles("primary", "md")} mt-6 inline-block`}>
                {copy.ctaPrimary}
              </Link>
            </div>
            <ul className="space-y-3">
              {copy.roomsPoints.map((point) => (
                <li
                  key={point}
                  className="flex items-start gap-3 rounded-2xl bg-surface p-4 shadow-soft"
                >
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ok-bg text-sm font-bold text-ok"
                  >
                    ✓
                  </span>
                  <span className="text-sm">{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Comment ça marche */}
        <section id="comment" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16 md:py-24">
          <p className="text-sm font-medium text-brand-deep">{copy.howKicker}</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
            {copy.howTitle}
          </h2>
          <div className="mt-10 grid gap-10 md:grid-cols-2">
            <div>
              <h3 className="text-xl font-semibold">{copy.practitionerTitle}</h3>
              <ol className="mt-5 space-y-5">
                {copy.practitionerSteps.map((step, index) => (
                  <li key={step.title} className="flex gap-4">
                    <span
                      aria-hidden="true"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand font-display text-base font-semibold text-brand-ink"
                    >
                      {index + 1}
                    </span>
                    <div>
                      <p className="font-medium">{step.title}</p>
                      <p className="mt-1 text-sm text-mist">{step.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h3 className="text-xl font-semibold">{copy.patientTitle}</h3>
              <ol className="mt-5 space-y-5">
                {copy.patientSteps.map((step, index) => (
                  <li key={step.title} className="flex gap-4">
                    <span
                      aria-hidden="true"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft font-display text-base font-semibold text-brand-deep"
                    >
                      {index + 1}
                    </span>
                    <div>
                      <p className="font-medium">{step.title}</p>
                      <p className="mt-1 text-sm text-mist">{step.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="border-t border-line bg-card">
          <div className="mx-auto w-full max-w-3xl scroll-mt-20 px-4 py-16 md:py-24">
            <p className="text-sm font-medium text-brand-deep">{copy.faqKicker}</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
              {copy.faqTitle}
            </h2>
            <div className="mt-8 space-y-3">
              {copy.faq.map((entry) => (
                <details
                  key={entry.question}
                  className="group rounded-2xl bg-surface px-5 py-4 shadow-soft"
                >
                  <summary className="cursor-pointer list-none font-medium marker:hidden [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center justify-between gap-4">
                      {entry.question}
                      <span aria-hidden="true" className="text-faint transition-transform group-open:rotate-45">
                        +
                      </span>
                    </span>
                  </summary>
                  <p className="mt-2 text-sm text-mist">{entry.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Appel final */}
        <section className="mx-auto w-full max-w-6xl px-4 py-16 md:py-24">
          <div className="rounded-3xl bg-brand-soft px-6 py-12 text-center md:py-16">
            <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-brand-deep md:text-4xl">
              {copy.finalTitle}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-mist">{copy.finalText}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/signup" className={buttonStyles("primary", "lg")}>
                {copy.ctaPrimary}
              </Link>
              <Link href="/login" className={buttonStyles("secondary", "lg")}>
                {copy.ctaSecondary}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-mist md:flex-row">
          <div>
            <p className="font-display font-semibold text-ink">Le Cabinet Partagé</p>
            <p className="mt-1">{copy.footerTagline}</p>
          </div>
          <div className="flex items-center gap-5">
            <Link href="/signup" className="transition-colors hover:text-ink">
              {copy.footerSignup}
            </Link>
            <Link href="/login" className="transition-colors hover:text-ink">
              {copy.footerPractitioners}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
