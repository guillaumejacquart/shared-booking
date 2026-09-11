"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { authClient } from "@/lib/auth-client";
import { t } from "@/lib/i18n";
import { Button, Field, FormMessage, TextInput } from "@/components/ui";

function ResetForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t("auth.passwordMismatch"));
      return;
    }
    setBusy(true);
    try {
      const { error } = await authClient.resetPassword({ newPassword: password, token });
      if (error) throw new Error(error.message || t("auth.resetFailed"));
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.resetFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return <p className="mt-6 text-sm text-red-600">{t("auth.resetInvalid")}</p>;
  }
  if (done) {
    return (
      <p className="mt-6 text-sm">
        {t("auth.resetDone")}{" "}
        <Link className="underline" href="/login">
          {t("auth.loginButton")}
        </Link>
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
      <Field label={t("auth.newPassword")}>
        <TextInput
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
        />
      </Field>
      <Field label={t("auth.confirmPassword")}>
        <TextInput
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
        />
      </Field>
      <FormMessage tone="error">{error ?? ""}</FormMessage>
      <Button type="submit" size="lg" disabled={busy}>
        {t("auth.resetButton")}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{t("auth.resetTitle")}</h1>
      <Suspense>
        <ResetForm />
      </Suspense>
    </main>
  );
}
