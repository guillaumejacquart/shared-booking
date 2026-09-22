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
      className="rounded-full border border-line bg-card px-3 py-1.5 text-sm transition-colors hover:bg-wash"
    >
      {t("dashboard.signOut")}
    </button>
  );
}
