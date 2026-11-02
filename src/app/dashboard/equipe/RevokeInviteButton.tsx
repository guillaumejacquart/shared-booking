"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { t } from "@/lib/i18n";
import { sendJson } from "@/lib/api-client";
import { ConfirmButton } from "@/components/ui";

/** Annule une invitation en attente (owner) : confirmation inline puis DELETE. */
export default function RevokeInviteButton({
  officeId,
  inviteId,
  inviteEmail,
}: {
  officeId: string;
  inviteId: string;
  inviteEmail: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      const result = await sendJson(`/api/offices/${officeId}/invites/${inviteId}`, "DELETE");
      if (!result.ok) throw new Error(result.error);
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
        confirmLabel={t("team.revokeConfirm", { email: inviteEmail })}
        onConfirm={revoke}
        busy={busy}
      >
        {t("team.revoke")}
      </ConfirmButton>
    </span>
  );
}
