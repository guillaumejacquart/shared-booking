"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { authClient } from "@/lib/auth-client";
import { t } from "@/lib/i18n";
import { Button, Field, FormMessage, TextInput } from "@/components/ui";

export default function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Retour vers la page d'origine (ex. invitation) — chemins relatifs uniquement.
  const rawNext = searchParams.get("next");
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : null;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await authClient.signUp.email({ name, email, password });
        if (error) throw new Error(error.message || t("auth.failed"));
        router.push(next ?? "/onboarding");
      } else {
        const { error } = await authClient.signIn.email({ email, password });
        if (error) throw new Error(error.message || t("auth.failed"));
        router.push(next ?? "/dashboard");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">
        {mode === "signup" ? t("auth.signupTitle") : t("auth.loginTitle")}
      </h1>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        {mode === "signup" ? (
          <Field label={t("auth.name")}>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} autoComplete="name" />
          </Field>
        ) : null}
        <Field label={t("auth.email")}>
          <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </Field>
        <Field label={t("auth.password")} hint={mode === "signup" ? t("auth.passwordHint") : undefined}>
          <TextInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />
        </Field>
        <FormMessage tone="error">{error ?? ""}</FormMessage>
        <Button type="submit" size="lg" disabled={busy}>
          {mode === "signup" ? t("auth.signupButton") : t("auth.loginButton")}
        </Button>
        {mode === "login" ? (
          <p className="text-center text-sm">
            <Link className="underline" href="/forgot-password">
              {t("auth.forgot")}
            </Link>
          </p>
        ) : null}
      </form>
      <p className="mt-4 text-center text-sm text-zinc-500">
        {mode === "signup" ? (
          <>
            {t("auth.haveAccount")} <Link className="underline" href="/login">{t("auth.loginButton")}</Link>
          </>
        ) : (
          <>
            {t("auth.noAccount")} <Link className="underline" href="/signup">{t("auth.signupButton")}</Link>
          </>
        )}
      </p>
    </main>
  );
}
