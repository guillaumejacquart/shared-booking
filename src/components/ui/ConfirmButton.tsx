"use client";

import { useEffect, useState } from "react";

import Button from "./Button";

/** Bouton à double validation inline (annulations destructives). */
export default function ConfirmButton({
  children,
  confirmLabel,
  onConfirm,
  busy,
  danger = true,
}: {
  children: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  busy?: boolean;
  danger?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  // Échap annule la confirmation en cours.
  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirming(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirming]);

  if (!confirming) {
    return (
      <Button
        type="button"
        size="sm"
        variant={danger ? "danger" : "secondary"}
        onClick={() => setConfirming(true)}
      >
        {children}
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-live="polite" className="text-xs text-mist">
        {confirmLabel}
      </span>
      <Button type="button" size="sm" variant={danger ? "danger" : "primary"} disabled={busy} onClick={() => void onConfirm()}>
        OK
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        ✕
      </Button>
    </span>
  );
}
