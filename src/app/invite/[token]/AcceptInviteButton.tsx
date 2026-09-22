"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { t } from "@/lib/i18n";

export default function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function accept() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/invites/${token}`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error((j?.error as string) || t("booking.errorGeneric"));
      }
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("booking.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        disabled={busy}
        onClick={accept}
        className="rounded-full bg-brand px-5 py-3 text-sm font-medium text-brand-ink shadow-soft transition-all duration-200 hover:bg-brand-deep disabled:opacity-50"
      >
        {t("invite.accept")}
      </button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
