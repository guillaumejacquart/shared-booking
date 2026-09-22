"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { t } from "@/lib/i18n";

/** Sélecteur des éléments focalisables (piège de focus). */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modale du design system : fond assombri, fermeture au clic extérieur,
 * à Échap et au bouton ✕, défilement de la page verrouillé.
 * Rendue en portail sur document.body, avec piège de focus.
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Piège Tab : boucle à l'intérieur du dialogue.
      if (e.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.offsetParent !== null || el === document.activeElement,
        );
        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Focus initial : premier focalisable, sinon le dialogue.
    const timer = window.setTimeout(() => {
      const dialog = dialogRef.current;
      const first = dialog?.querySelector<HTMLElement>(FOCUSABLE);
      if (first) first.focus();
      else dialog?.focus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      // Restaure le focus précédent à la fermeture.
      if (previousFocus.current instanceof HTMLElement) previousFocus.current.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-3xl border border-line bg-card p-5 shadow-lift"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <h2 className="mr-auto text-lg font-semibold">{title}</h2>
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={onClose}
            className="rounded-full border border-line px-2.5 py-1 text-sm text-mist transition-colors hover:bg-wash hover:text-ink"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
