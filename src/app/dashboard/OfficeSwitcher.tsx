"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { sendJson } from "@/lib/api-client";
import type { DashboardOffice } from "@/lib/dashboard";
import { t } from "@/lib/i18n";

/**
 * Sélecteur de cabinet (multi-cabinet) : la dropdown liste les cabinets
 * d'appartenance active, le choix est mémorisé côté serveur puis le
 * dashboard est rafraîchi sur le cabinet sélectionné.
 */
export default function OfficeSwitcher({
  offices,
  currentOfficeId,
}: {
  offices: DashboardOffice[];
  currentOfficeId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  }, [open ]);

  if (offices.length <= 1) {
    return <p className="truncate text-xs text-mist">{offices[0]?.name ?? ""}</p>;
  }
  const current = offices.find((office) => office.id === currentOfficeId) ?? offices[0];

  async function select(officeId: string) {
    if (officeId === currentOfficeId || busyId) return;
    setBusyId(officeId);
    setError(null);
    try {
      const result = await sendJson("/api/me/office", "PATCH", { officeId });
      if (!result.ok) throw new Error(result.error);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("booking.errorGeneric"));
    } finally {
      setBusyId(null);
    }
  }

  const itemStyles =
    "flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-ink transition-colors hover:bg-wash disabled:opacity-50";
  return (
    <div ref={menuRef} className="relative min-w-0">
      <button
        type="button"
        title={t("dashboard.switchOffice")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex max-w-full items-center gap-1 truncate text-xs text-mist transition-colors hover:text-ink"
      >
        <span className="truncate">{current.name}</span>
        <span aria-hidden="true" className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute left-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-line bg-card py-1 shadow-lift"
        >
          {offices.map((office) => (
            <button
              key={office.id}
              type="button"
              role="menuitemradio"
              aria-checked={office.id === currentOfficeId}
              disabled={busyId !== null}
              onClick={() => void select(office.id)}
              className={itemStyles}
            >
              <span className="min-w-0 flex-1 truncate font-medium">{office.name}</span>
              <span className="shrink-0 text-xs text-mist">
                {office.role === "owner" ? t("team.roleOwner") : t("team.rolePractitioner")}
              </span>
              {office.id === currentOfficeId ? <span aria-hidden="true">✓</span> : null}
            </button>
          ))}
          {error ? <p className="px-4 py-2 text-xs text-red-600">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
