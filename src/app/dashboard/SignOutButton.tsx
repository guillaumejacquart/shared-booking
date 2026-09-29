"use client";

import { useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui";

export default function SignOutButton() {
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      onClick={() => {
        void authClient.signOut().then(() => router.push("/login"));
      }}
    >
      {t("dashboard.signOut")}
    </Button>
  );
}
