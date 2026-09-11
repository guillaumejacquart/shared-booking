"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { DashboardContext } from "@/lib/dashboard";
import { t } from "@/lib/i18n";
import SignOutButton from "./SignOutButton";

export default function DashboardNav({ ctx }: { ctx: DashboardContext }) {
  const pathname = usePathname();
  const links = [
    { href: "/dashboard", label: t("dashboard.agenda"), exact: true },
    { href: "/dashboard/calendrier", label: t("dashboard.calendar") },
    { href: "/dashboard/profil", label: t("dashboard.profile") },
    ...(ctx.role === "owner"
      ? [{ href: "/dashboard/parametres", label: t("dashboard.settings") }]
      : []),
  ];
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <div className="mr-auto">
          <p className="text-xs text-zinc-500">{ctx.officeName}</p>
          <p className="text-sm font-semibold">{ctx.userName}</p>
        </div>
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          {links.map((l) => {
            const active = l.exact ? pathname === l.href : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-full px-3 py-1.5 ${
                  active
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <Link
          href={`/p/${ctx.practitionerSlug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {t("dashboard.publicPage")}
        </Link>
        <SignOutButton />
      </div>
    </header>
  );
}
