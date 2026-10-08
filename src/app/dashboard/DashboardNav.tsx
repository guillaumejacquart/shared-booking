"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { DashboardContext } from "@/lib/dashboard";
import { t } from "@/lib/i18n";
import { Badge } from "@/components/ui";
import UserMenu from "./UserMenu";

/**
 * Lien(s) vers les pages publiques : lien direct vers la page praticien,
 * ou dropdown praticien + cabinet quand la page cabinet est activée.
 */
function PublicPageLink({ ctx }: { ctx: DashboardContext }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!ctx.officePageEnabled) {
    return (
      <Link
        href={`/p/${ctx.practitionerSlug}`}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 whitespace-nowrap rounded-full border border-line bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-wash"
      >
        {t("dashboard.publicPage")}
      </Link>
    );
  }

  const itemStyles =
    "block w-full px-4 py-2 text-left text-sm text-ink transition-colors hover:bg-wash";
  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="whitespace-nowrap rounded-full border border-line bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-wash"
      >
        {t("dashboard.publicPage")}
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-line bg-card py-1 shadow-lift"
        >
          <Link
            role="menuitem"
            href={`/p/${ctx.practitionerSlug}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className={itemStyles}
          >
            {t("profile.publicTitle")}
          </Link>
          <Link
            role="menuitem"
            href={`/o/${ctx.officeSlug}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className={itemStyles}
          >
            {t("settings.officePage")}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

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
    { href: "/dashboard/statistiques", label: t("dashboard.statistics") },
  ];
  return (
    <header className="border-b border-line bg-card">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 md:flex-nowrap">
        <div className="mr-auto min-w-0">
          <p className="truncate text-xs text-mist">{ctx.officeName}</p>
          <p className="truncate font-display text-sm font-semibold">{ctx.userName}</p>
        </div>
        <nav className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
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
        <div className="flex shrink-0 items-center gap-2">
          <PublicPageLink ctx={ctx} />
          <UserMenu email={ctx.userEmail} isOwner={ctx.role === "owner"} />
        </div>
      </div>
    </header>
  );
}
