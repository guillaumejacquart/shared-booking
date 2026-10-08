import Link from "next/link";

import { getDashboardContext } from "@/lib/dashboard";
import { isSubscriptionEnabled } from "@/lib/env";
import { services } from "@/lib/container";
import { t } from "@/lib/i18n";
import DashboardNav from "./DashboardNav";

/**
 * Bandeau d'abonnement (non bloquant) : visible par le owner uniquement,
 * quand la facturation est configurée mais l'abonnement inactif.
 */
async function BillingBanner({ userId }: { userId: string }) {
  if (!isSubscriptionEnabled) return null;
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
    // Thème unique : le backoffice suit l'ambiance du cabinet, comme les
    // pages publiques (sélecteurs CSS `[data-palette]` / `[data-mode]`).
    <div
      id="dashboard-theme"
      data-palette={ctx.officePalette}
      data-mode={ctx.officeThemeMode}
      className="flex min-h-full flex-1 flex-col bg-surface text-ink"
    >
      <DashboardNav ctx={ctx} />
      <BillingBanner userId={ctx.userId} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
