"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { t } from "@/lib/i18n";

/**
 * Menu compte : l'email ouvre une dropdown avec le profil praticien,
 * les paramètres (owner) et la déconnexion.
 */
export default function UserMenu({
  email,
  isOwner,
}: {
  email: string;
  isOwner: boolean;
}) {
  const router = useRouter();
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

  function handleSignOut() {
    setOpen(false);
    void authClient.signOut().then(() => router.push("/login"));
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
        className="inline-flex max-w-48 items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors hover:bg-wash"
      >
        <span className="truncate">{email}</span>
        <span
          aria-hidden="true"
          className={`shrink-0 text-xs text-mist transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-line bg-card py-1 shadow-lift"
        >
          <Link
            role="menuitem"
            href="/dashboard/profil"
            onClick={() => setOpen(false)}
            className={itemStyles}
          >
            {t("dashboard.profile")}
          </Link>
          {isOwner ? (
            <Link
              role="menuitem"
              href="/dashboard/parametres"
              onClick={() => setOpen(false)}
              className={itemStyles}
            >
              {t("dashboard.settings")}
            </Link>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            className={`${itemStyles} border-t border-line text-danger`}
          >
            {t("dashboard.signOut")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
