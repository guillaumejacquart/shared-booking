"use client";

import { useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";
import { t } from "@/lib/i18n";

export default function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        void authClient.signOut().then(() => router.push("/login"));
      }}
      className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
    >
      {t("dashboard.signOut")}
    </button>
  );
}
