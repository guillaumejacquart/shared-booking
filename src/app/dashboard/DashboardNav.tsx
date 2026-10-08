"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { DashboardContext } from "@/lib/dashboard";
import { t } from "@/lib/i18n";
import { Badge } from "@/components/ui";
import SignOutButton from "./SignOutButton";

export default function DashboardNav({ ctx }: { ctx: DashboardContext }) {
  const pathname = usePathname();
  const links: { href: string; label: string; exact?: boolean; count?: number }[] = [
    { href: "/dashboard", label: t("dashboard.agenda"), exact: true },
    {
      href: "/dashboard/reservations",
      label: t("dashboard.reservations"),
      count: ctx.pendingCount,
    },
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
          {links.map((link) => {
            const active = link.exact
              ? pathname === link.href
              : pathname.startsWith(link.href);
            const count = link.count ?? 0;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors ${
                  active
                    ? "bg-brand font-medium text-brand-ink shadow-soft"
                    : "text-mist hover:bg-wash hover:text-ink"
                }`}
              >
                {link.label}
                {count > 0 ? <Badge tone="amber">{count}</Badge> : null}
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
        <SignOutButton />
      </div>
    </header>
  );
}
