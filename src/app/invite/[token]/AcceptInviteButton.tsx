"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { t } from "@/lib/i18n";
import { sendJson } from "@/lib/api-client";
import { Button, FormMessage } from "@/components/ui";

export default function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function accept() {
    setError(null);
    setBusy(true);
    try {
      const result = await sendJson(`/api/invites/${token}`, "POST");
      if (result.ok) router.push("/dashboard");
      else setError(result.error);
    } catch {
      setError(t("booking.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Button size="lg" disabled={busy} onClick={accept}>
        {t("invite.accept")}
      </Button>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}
