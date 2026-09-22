import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { getOfficePage } from "@/dal/offices";
import { t } from "@/lib/i18n";
import { parseMode, parsePalette } from "@/lib/theme";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = await getOfficePage(slug);
  return { title: page ? `${page.office.name} — Réservation` : "Page introuvable" };
}

export default async function OfficePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = await getOfficePage(slug);
  if (!page) notFound();

  return (
    <div
      data-palette={parsePalette(page.office.themePalette)}
      data-mode={parseMode(page.office.themeMode)}
      className="flex min-h-full flex-1 flex-col bg-surface text-ink"
    >
      <main className="mx-auto w-full max-w-2xl px-4 py-10">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">{page.office.name}</h1>
          {page.office.address ? (
            <p className="mt-1 text-mist">{page.office.address}</p>
          ) : null}
        </header>
        <h2 className="mb-3 text-lg font-semibold">{t("office.practitioners")}</h2>
        <div className="grid gap-3">
          {page.practitioners.map(({ practitioner: prac, sessionTypes }) => (
            <div
              key={prac.id}
              className="rounded-3xl border border-line bg-card p-5 shadow-soft"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-lg font-medium">{prac.displayName}</h3>
                {sessionTypes.length > 0 ? (
                  <Link
                    href={`/p/${prac.slug}`}
                    className="shrink-0 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-ink shadow-soft transition-all duration-200 hover:bg-brand-deep"
                  >
                    {t("office.book")}
                  </Link>
                ) : null}
              </div>
              {prac.bio ? (
                <p className="mt-1 whitespace-pre-line text-sm text-mist">{prac.bio}</p>
              ) : null}
              {sessionTypes.length > 0 ? (
                <p className="mt-2 text-sm text-mist">
                  {t("office.sessions")} : {sessionTypes.map((s) => s.name).join(" · ")}
                </p>
              ) : (
                <p className="mt-2 text-sm text-mist">{t("office.none")}</p>
              )}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
