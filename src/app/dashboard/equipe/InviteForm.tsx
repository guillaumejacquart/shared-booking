"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { t } from "@/lib/i18n";
import { sendJson } from "@/lib/api-client";
import { Button, Field, FormMessage, Select, TextInput } from "@/components/ui";

export default function InviteForm({ officeId }: { officeId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"practitioner" | "owner">("practitioner");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await sendJson(`/api/offices/${officeId}/invites`, "POST", { email, role });
      if (!result.ok) throw new Error(result.error);
      setEmail("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("booking.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <Field label="Email">
        <TextInput
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          maxLength={254}
          placeholder={t("team.invitePlaceholder")}
        />
      </Field>
      <Field label="Rôle">
        <Select value={role} onChange={(event) => setRole(event.target.value as "owner" | "practitioner")}>
          <option value="practitioner">Praticien</option>
          <option value="owner">Responsable</option>
        </Select>
      </Field>
      <Button type="submit" disabled={busy}>
        {t("team.inviteButton")}
      </Button>
      <FormMessage tone="error">{error ?? ""}</FormMessage>
    </form>
  );
}
