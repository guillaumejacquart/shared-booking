import Link from "next/link";

import { t } from "@/lib/i18n";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-2xl flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">{t("home.title")}</h1>
      <p className="mt-4 max-w-md text-zinc-600">{t("home.subtitle")}</p>
      <Link
        href="/login"
        className="mt-8 rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium hover:bg-zinc-100"
      >
        {t("home.practitioners")}
      </Link>
    </main>
  );
}
