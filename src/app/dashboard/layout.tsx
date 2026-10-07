import Link from "next/link";

import { getDashboardContext } from "@/lib/dashboard";
import { services } from "@/lib/container";
import { t } from "@/lib/i18n";
import DashboardNav from "./DashboardNav";

/**
 * Bandeau d'abonnement (non bloquant) : visible par le owner uniquement,
 * quand la facturation est configurée mais l'abonnement inactif.
 */
async function BillingBanner({ userId }: { userId: string }) {
  const status = await services.billing.getBillingStatus(userId).catch(() => null);
  if (!status || !status.configured || !status.priceConfigured) return null;
  if (!status.isOwner || status.active) return null;
  return (
    <p className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
      {t("billing.banner")}{" "}
      <Link href="/dashboard/parametres?tab=abonnement" className="font-semibold underline">
        {t("billing.bannerCta")}
      </Link>
    </p>
  );
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getDashboardContext();
  return (
    <div className="flex min-h-full flex-col">
      <DashboardNav ctx={ctx} />
      <BillingBanner userId={ctx.userId} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
