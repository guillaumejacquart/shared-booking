"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { t } from "@/lib/i18n";

/**
 * Retour Stripe Checkout : scrute le statut (le webhook confirme en
 * arrière-plan, avec un léger délai possible).
 */
function MerciStatus({ slug }: { slug: string }) {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id") ?? "";
  const [state, setState] = useState<"waiting" | "confirmed" | "pendingValidation" | "failed">(
    sessionId ? "waiting" : "failed",
  );

  useEffect(() => {
    if (!sessionId) return;
    let stop = false;
    let attempts = 0;
    async function poll(): Promise<void> {
      attempts++;
      try {
        const res = await fetch(`/api/b/by-session?sessionId=${encodeURIComponent(sessionId)}`);
        if (res.ok) {
          const j = (await res.json()) as { status: string; paymentStatus: string };
          if (j.status === "confirmed") {
            if (!stop) setState("confirmed");
            return;
          }
          if (j.paymentStatus === "paid") {
            if (!stop) setState("pendingValidation");
            return;
          }
        }
      } catch {
        // Réessaie jusqu'au timeout.
      }
      if (!stop && attempts < 20) setTimeout(() => void poll(), 3000);
      else if (!stop) setState("failed");
    }
    void poll();
    return () => {
      stop = true;
    };
  }, [sessionId]);

  return (
    <main className="mx-auto w-full max-w-md px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{t("merci.title")}</h1>
      <div className="mt-4 text-sm text-zinc-600 dark:text-zinc-300">
        {state === "waiting" ? <p>{t("merci.waiting")}</p> : null}
        {state === "confirmed" ? <p>{t("merci.confirmed")}</p> : null}
        {state === "pendingValidation" ? <p>{t("merci.pendingValidation")}</p> : null}
        {state === "failed" ? (
          <p>
            {t("merci.failed")}{" "}
            <Link className="underline" href={`/p/${slug}`}>
              {t("merci.retry")}
            </Link>
          </p>
        ) : null}
      </div>
    </main>
  );
}

export default function MerciPage({ slug }: { slug: string }) {
  return (
    <Suspense>
      <MerciStatus slug={slug} />
    </Suspense>
  );
}
