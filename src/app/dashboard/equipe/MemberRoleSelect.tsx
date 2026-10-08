"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { t } from "@/lib/i18n";
import { sendJson } from "@/lib/api-client";

/** Change le rôle d'un membre (owner) : sélecteur responsable / praticien puis PATCH. */
export default function MemberRoleSelect({
  officeId,
  memberId,
  currentRole,
}: {
  officeId: string;
  memberId: string;
  currentRole: string;
}) {
  const router = useRouter();
  const [role, setRole] = useState(currentRole);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(nextRole: string) {
    if (nextRole === currentRole || busy) {
      setRole(currentRole);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await sendJson(`/api/offices/${officeId}/members/${memberId}`, "PATCH", {
      role: nextRole,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setRole(currentRole);
      return;
    }
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
      <select
        aria-label={t("team.role")}
        className="rounded-xl border border-line bg-card px-2 py-1 text-sm"
        value={role}
        disabled={busy}
        onChange={(event) => {
          setRole(event.target.value);
          void change(event.target.value);
        }}
      >
        <option value="owner">{t("team.roleOwner")}</option>
        <option value="practitioner">{t("team.rolePractitioner")}</option>
      </select>
    </span>
  );
}
