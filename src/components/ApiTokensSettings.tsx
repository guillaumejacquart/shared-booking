"use client";

import { useState } from "react";

import { t } from "@/lib/i18n";
import type { ApiTokenMeta, CreatedApiToken } from "@/services/api-tokens";
import { Button, ConfirmButton, Field, FormMessage, TextInput, Toggle } from "@/components/ui";

/**
 * Clés d'API personnelles du praticien (onglet Profil → API).
 * Création (secret affiché une seule fois), liste (métadonnées seules),
 * révocation. Le secret en clair ne transite que dans la réponse de
 * création, jamais dans la liste.
 */
export default function ApiTokensSettings({
  initial,
}: {
  initial: ApiTokenMeta[];
}) {
  const [tokens, setTokens] = useState<ApiTokenMeta[]>(initial);
  const [name, setName] = useState("");
  const [write, setWrite] = useState(true);
  const [expires, setExpires] = useState("");
  const [created, setCreated] = useState<CreatedApiToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function refresh() {
    const res = await fetch("/api/tokens");
    if (!res.ok) throw new Error(t("booking.errorGeneric"));
    const body = (await res.json()) as { tokens: ApiTokenMeta[] };
    setTokens(body.tokens);
  }

  async function create() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          write,
          expiresAt: expires ? new Date(expires).toISOString() : null,
        }),
      });
      const body = (await res.json().catch(() => null)) as CreatedApiToken | { error?: string } | null;
      if (!res.ok || !body || !("token" in body)) {
        throw new Error(
          (body as { error?: string } | null)?.error ?? t("booking.errorGeneric"),
        );
      }
      setCreated(body);
      setCopied(false);
      setName("");
      setExpires("");
      await refresh();
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : t("booking.errorGeneric"),
      });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(tokenId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/tokens/${tokenId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(t("booking.errorGeneric"));
      setMessage({ ok: true, text: t("api.revokedOk") });
      await refresh();
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : t("booking.errorGeneric"),
      });
    } finally {
      setBusy(false);
    }
  }

  async function copySecret(secret: string) {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setMessage({ ok: false, text: t("booking.errorGeneric") });
    }
  }

  function statusOf(token: ApiTokenMeta): string | null {
    if (token.revokedAt) return t("api.revoked");
    if (token.expired) return t("api.expired");
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-mist">{t("api.intro")}</p>

      {created ? (
        <div className="rounded-lg border border-warn bg-warn-bg p-4">
          <p className="font-semibold text-warn">{t("api.createdTitle")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-surface px-2 py-1 text-sm text-ink">
              {created.token}
            </code>
            <Button size="sm" variant="secondary" onClick={() => void copySecret(created.token)}>
              {copied ? t("api.copied") : t("api.copy")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
              {t("common.close")}
            </Button>
          </div>
          <p className="mt-2 text-sm text-warn">{t("api.createdWarning")}</p>
        </div>
      ) : null}

      <form
        className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) void create();
        }}
      >
        <Field label={t("api.newName")}>
          <TextInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("api.newNamePlaceholder")}
            maxLength={60}
          />
        </Field>
        <Toggle checked={write} onChange={setWrite} label={t("api.write")} />
        <p className="-mt-2 text-xs text-mist">{t("api.writeHint")}</p>
        <Field label={t("api.expires")}>
          <TextInput
            type="date"
            value={expires}
            onChange={(event) => setExpires(event.target.value)}
          />
        </Field>
        <div>
          <Button type="submit" disabled={busy || !name.trim()}>
            {t("api.create")}
          </Button>
        </div>
      </form>

      {message ? <FormMessage tone={message.ok ? "ok" : "error"}>{message.text}</FormMessage> : null}

      {tokens.length === 0 ? (
        <p className="text-sm text-mist">{t("api.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tokens.map((token) => {
            const status = statusOf(token);
            return (
              <li
                key={token.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-card px-3 py-2"
              >
                <span className="font-medium">{token.name}</span>
                <code className="text-xs text-mist">…{token.prefix}</code>
                <span className="text-xs text-mist">
                  {token.scopes.includes("write") ? t("api.scopeWrite") : t("api.scopeRead")}
                </span>
                {status ? (
                  <span className="text-xs font-semibold text-warn">{status}</span>
                ) : (
                  <ConfirmButton
                    confirmLabel={t("api.revokeConfirm")}
                    busy={busy}
                    onConfirm={() => void revoke(token.id)}
                  >
                    {t("api.revoke")}
                  </ConfirmButton>
                )}
                <span className="w-full text-xs text-mist">
                  {token.expiresAt
                    ? t("api.expiresOn", {
                        date: new Date(token.expiresAt).toLocaleDateString("fr-FR"),
                      })
                    : t("api.neverExpires")}
                  {" · "}
                  {token.lastUsedAt
                    ? t("api.lastUsed", {
                        date: new Date(token.lastUsedAt).toLocaleDateString("fr-FR"),
                      })
                    : t("api.neverUsed")}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
