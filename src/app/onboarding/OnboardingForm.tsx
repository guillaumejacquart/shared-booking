"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { t } from "@/lib/i18n";
import { Button, Field, FormMessage, TextInput } from "@/components/ui";

export default function OnboardingForm({ userName }: { userName: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function onName(v: string) {
    setName(v);
    setSlug(
      v
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/offices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug, address: address || undefined }),
      });
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
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t("onboarding.title")}, {userName}
      </h1>
      <p className="mt-2 text-sm text-zinc-500">{t("onboarding.subtitle")}</p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <Field label={t("onboarding.officeName")}>
          <TextInput value={name} onChange={(e) => onName(e.target.value)} required maxLength={80} />
        </Field>
        <Field label={t("onboarding.officeSlug")} hint="Lettres, chiffres, tirets.">
          <TextInput
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            pattern="[a-z0-9-]{3,60}"
            maxLength={60}
          />
        </Field>
        <Field label={t("onboarding.address")}>
          <TextInput value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} />
        </Field>
        <FormMessage tone="error">{error ?? ""}</FormMessage>
        <Button type="submit" size="lg" disabled={busy}>
          {t("onboarding.create")}
        </Button>
      </form>
    </main>
  );
}
