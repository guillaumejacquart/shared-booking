"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { t } from "@/lib/i18n";
import { Button, Field, FormMessage, Select, TextInput } from "@/components/ui";

export default function InviteForm({ officeId }: { officeId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"practitioner" | "owner">("practitioner");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/offices/${officeId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error((j?.error as string) || t("booking.errorGeneric"));
      }
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
          onChange={(e) => setEmail(e.target.value)}
          required
          maxLength={254}
          placeholder={t("team.invitePlaceholder")}
        />
      </Field>
      <Field label="Rôle">
        <Select value={role} onChange={(e) => setRole(e.target.value as "owner" | "practitioner")}>
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
