"use client";

import { useEffect } from "react";

import { t } from "@/lib/i18n";

/**
 * Modale du design system : fond assombri, fermeture au clic extérieur,
 * à Échap et au bouton ✕, défilement de la page verrouillé.
 */
export default function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <h2 className="mr-auto text-lg font-semibold">{title}</h2>
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={onClose}
            className="rounded-full border border-zinc-300 px-2.5 py-1 text-sm dark:border-zinc-700"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
