"use client";

import { useState } from "react";
import Link from "next/link";

import { authClient } from "@/lib/auth-client";
import { t } from "@/lib/i18n";
import { Button, Field, TextInput } from "@/components/ui";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    } finally {
      // Toujours le même message (ne révèle pas si l'email existe).
      setSent(true);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{t("auth.forgotTitle")}</h1>
      {sent ? (
        <p className="mt-6 text-sm">{t("auth.forgotSent")}</p>
      ) : (
        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          <Field label={t("auth.email")}>
            <TextInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </Field>
          <Button type="submit" size="lg" disabled={busy}>
            {t("auth.forgotButton")}
          </Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm text-mist">
        <Link className="underline" href="/login">
          {t("auth.loginButton")}
        </Link>
      </p>
    </main>
  );
}
