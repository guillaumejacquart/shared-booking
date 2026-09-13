"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { t } from "@/lib/i18n";
import { ConfirmButton } from "@/components/ui";

/** Retire un membre du cabinet (owner) : confirmation inline puis DELETE. */
export default function RemoveMemberButton({
  officeId,
  memberId,
  memberName,
}: {
  officeId: string;
  memberId: string;
  memberName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/offices/${officeId}/members/${memberId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error((j?.error as string) || t("booking.errorGeneric"));
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("booking.errorGeneric"));
      setBusy(false);
    }
  }

  return (
    <span className="ml-auto inline-flex items-center gap-2">
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
      <ConfirmButton
        confirmLabel={t("team.removeConfirm", { name: memberName })}
        onConfirm={remove}
        busy={busy}
      >
        {t("team.remove")}
      </ConfirmButton>
    </span>
  );
}
