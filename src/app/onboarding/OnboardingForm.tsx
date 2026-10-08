"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { t } from "@/lib/i18n";
import { sendJson } from "@/lib/api-client";
import AuthShell from "@/components/AuthShell";
import { Button, Field, FormMessage, TextInput } from "@/components/ui";

export default function OnboardingForm({ userName }: { userName: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function onName(value: string) {
    setName(value);
    setSlug(
      value
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await sendJson("/api/offices", "POST", { name, slug, address: address || undefined });
      if (!result.ok) throw new Error(result.error);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("booking.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="text-2xl font-semibold tracking-tight">
        {t("onboarding.title")}, {userName}
      </h1>
      <p className="mt-2 text-sm text-mist">{t("onboarding.subtitle")}</p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <Field label={t("onboarding.officeName")}>
          <TextInput value={name} onChange={(event) => onName(event.target.value)} required maxLength={80} />
        </Field>
        <Field label={t("onboarding.officeSlug")} hint="Lettres, chiffres, tirets.">
          <TextInput
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            required
            pattern="[a-z0-9-]{3,60}"
            maxLength={60}
          />
        </Field>
        <Field label={t("onboarding.address")}>
          <TextInput value={address} onChange={(event) => setAddress(event.target.value)} maxLength={200} />
        </Field>
        <FormMessage tone="error">{error ?? ""}</FormMessage>
        <Button type="submit" size="lg" disabled={busy}>
          {t("onboarding.create")}
        </Button>
      </form>
    </AuthShell>
  );
}
