"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { t } from "@/lib/i18n";
import { sendJson } from "@/lib/api-client";
import { Button, Field, FormMessage, TextInput, Textarea } from "@/components/ui";
import PublicLinkCard from "@/components/PublicLinkCard";

export default function ProfileForm({
  practitionerId,
  initial,
  officeSlug,
  officePageEnabled = false,
}: {
  practitionerId: string;
  initial: { displayName: string; slug: string; bio: string | null; publicContact: string | null };
  officeSlug: string;
  officePageEnabled?: boolean;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [slug, setSlug] = useState(initial.slug);
  const [bio, setBio] = useState(initial.bio ?? "");
  const [publicContact, setPublicContact] = useState(initial.publicContact ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await sendJson(`/api/practitioners/${practitionerId}`, "PATCH", { displayName, slug, bio: bio || undefined, publicContact: publicContact || undefined });
      if (!result.ok) throw new Error(result.error);
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
      {officePageEnabled ? (
        <PublicLinkCard
          path={`/o/${officeSlug}`}
          title={t("settings.officePage")}
          description={t("settings.officePageHint")}
        />
      ) : null}

      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("auth.name")}>
            <TextInput value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={100} />
          </Field>
          <Field label="Identifiant public" hint="/p/…">
            <TextInput value={slug} onChange={(event) => setSlug(event.target.value)} required pattern="[a-z0-9-]{2,60}" maxLength={60} />
          </Field>
        </div>
        <Field label="Bio">
          <Textarea value={bio} onChange={(event) => setBio(event.target.value)} rows={3} maxLength={2000} />
        </Field>
        <Field label="Contact public (optionnel)">
          <TextInput value={publicContact} onChange={(event) => setPublicContact(event.target.value)} maxLength={200} />
        </Field>
        {message ? <FormMessage tone={message.ok ? "ok" : "error"}>{message.text}</FormMessage> : null}
        <Button type="submit" disabled={busy} className="w-fit">
          {t("sessionTypesAdmin.save")}
        </Button>
      </form>
    </div>
  );
}
