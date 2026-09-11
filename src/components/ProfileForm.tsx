"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { t } from "@/lib/i18n";
import { Button, Field, FormMessage, TextInput, Textarea } from "@/components/ui";
import PublicLinkCard from "@/components/PublicLinkCard";

export default function ProfileForm({
  practitionerId,
  initial,
}: {
  practitionerId: string;
  initial: { displayName: string; slug: string; bio: string | null; publicContact: string | null };
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [slug, setSlug] = useState(initial.slug);
  const [bio, setBio] = useState(initial.bio ?? "");
  const [publicContact, setPublicContact] = useState(initial.publicContact ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/practitioners/${practitionerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, slug, bio: bio || undefined, publicContact: publicContact || undefined }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error((j?.error as string) || t("booking.errorGeneric"));
      }
      setMessage({ ok: true, text: t("dashboard.saved") });
      router.refresh();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t("booking.errorGeneric") });
    } finally {
      setBusy(false);
    }
  }

  const publicPath = `/p/${initial.slug}`;

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <PublicLinkCard
        path={publicPath}
        title={t("profile.publicTitle")}
        description={t("profile.publicHint")}
      />

      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("auth.name")}>
            <TextInput value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={100} />
          </Field>
          <Field label="Identifiant public" hint="/p/…">
            <TextInput value={slug} onChange={(e) => setSlug(e.target.value)} required pattern="[a-z0-9-]{2,60}" maxLength={60} />
          </Field>
        </div>
        <Field label="Bio">
          <Textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} maxLength={2000} />
        </Field>
        <Field label="Contact public (optionnel)">
          <TextInput value={publicContact} onChange={(e) => setPublicContact(e.target.value)} maxLength={200} />
        </Field>
        {message ? <FormMessage tone={message.ok ? "ok" : "error"}>{message.text}</FormMessage> : null}
        <Button type="submit" disabled={busy} className="w-fit">
          {t("sessionTypesAdmin.save")}
        </Button>
      </form>
    </div>
  );
}
