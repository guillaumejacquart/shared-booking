import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { db } from "@/db/client";
import { getOfficePage } from "@/dal/offices";
import { t } from "@/lib/i18n";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = await getOfficePage(db, slug);
  return { title: page ? `${page.office.name} — Réservation` : "Page introuvable" };
}

export default async function OfficePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = await getOfficePage(db, slug);
  if (!page) notFound();

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">{page.office.name}</h1>
        {page.office.address ? (
          <p className="mt-1 text-zinc-500">{page.office.address}</p>
        ) : null}
      </header>
      <h2 className="mb-3 text-lg font-semibold">{t("office.practitioners")}</h2>
      <div className="grid gap-3">
        {page.practitioners.map(({ practitioner: prac, sessionTypes }) => (
          <div
            key={prac.id}
            className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800"
          >
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-lg font-medium">{prac.displayName}</h3>
              {sessionTypes.length > 0 ? (
                <Link
                  href={`/p/${prac.slug}`}
                  className="shrink-0 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {t("office.book")}
                </Link>
              ) : null}
            </div>
            {prac.bio ? (
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{prac.bio}</p>
            ) : null}
            {sessionTypes.length > 0 ? (
              <p className="mt-2 text-sm text-zinc-500">
                {t("office.sessions")} : {sessionTypes.map((s) => s.name).join(" · ")}
              </p>
            ) : (
              <p className="mt-2 text-sm text-zinc-500">{t("office.none")}</p>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
