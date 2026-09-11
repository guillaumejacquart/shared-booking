"use client";

import { useState } from "react";

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
      <span className="text-xs text-zinc-500">{confirmLabel}</span>
      <Button type="button" size="sm" variant={danger ? "danger" : "primary"} disabled={busy} onClick={() => void onConfirm()}>
        OK
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        ✕
      </Button>
    </span>
  );
}
