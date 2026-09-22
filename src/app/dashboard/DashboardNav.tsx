"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { DashboardContext } from "@/lib/dashboard";
import { t } from "@/lib/i18n";
import SignOutButton from "./SignOutButton";
import ThemeSwitcher from "./ThemeSwitcher";

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
    <header className="border-b border-line bg-card">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <div className="mr-auto">
          <p className="text-xs text-mist">{ctx.officeName}</p>
          <p className="font-display text-sm font-semibold">{ctx.userName}</p>
        </div>
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          {links.map((l) => {
            const active = l.exact ? pathname === l.href : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-full px-3 py-1.5 transition-colors ${
                  active
                    ? "bg-brand font-medium text-brand-ink shadow-soft"
                    : "text-mist hover:bg-wash hover:text-ink"
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
          className="rounded-full border border-line bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-wash"
        >
          {t("dashboard.publicPage")}
        </Link>
        {/* Remonté quand le contexte thème change (ambiance ou choix) :
            l'état local repart de la valeur effective. */}
        <ThemeSwitcher
          key={`${ctx.officePalette}/${ctx.userPalette ?? "-"}/${ctx.userMode ?? "-"}`}
          officePalette={ctx.officePalette}
          userPalette={ctx.userPalette}
          userMode={ctx.userMode}
        />
        <SignOutButton />
      </div>
    </header>
  );
}
