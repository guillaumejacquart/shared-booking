import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { db } from "@/db/client";
import { getPractitionerPage } from "@/dal/practitioners";
import { t } from "@/lib/i18n";
import BookingWidget from "./BookingWidget";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPractitionerPage(db, slug);
  return {
    title: page ? `${page.practitioner.displayName} — Réservation` : "Page introuvable",
  };
}

export default async function PractitionerPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const page = await getPractitionerPage(db, slug);
  if (!page) notFound();
  const paymentCanceled = sp.paiement === "annule";

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <header className="mb-8">
        <p className="text-sm text-zinc-500">{page.office.name}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          {page.practitioner.displayName}
        </h1>
        {page.practitioner.bio ? (
          <p className="mt-2 whitespace-pre-line text-zinc-600 dark:text-zinc-300">
            {page.practitioner.bio}
          </p>
        ) : null}
      </header>
      {paymentCanceled ? (
        <p className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950">
          {t("booking.paymentCanceled")}
        </p>
      ) : null}
      <BookingWidget
        slug={page.practitioner.slug}
        sessionTypes={page.sessionTypes.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          durationMin: s.durationMin,
          priceDisplay: s.priceDisplay,
          requiresPayment: s.requiresPayment,
          priceCents: s.priceCents,
          currency: s.currency,
        }))}
      />
    </main>
  );
}
