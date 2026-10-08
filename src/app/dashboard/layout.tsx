import Link from "next/link";

import * as roomsDal from "@/dal/rooms";
import { getDashboardContext } from "@/lib/dashboard";
import { isSubscriptionEnabled } from "@/lib/env";
import { services } from "@/lib/container";
import { t } from "@/lib/i18n";
import RoomsMissingAlert from "@/components/RoomsMissingAlert";
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

/**
 * Bandeau "aucune salle" : sans salle au cabinet, le moteur de créneaux
 * ne produit rien et la page de réservation reste vide sans explication.
 * Échec silencieux (jamais de crash du dashboard pour un bandeau).
 */
async function RoomsBanner({ officeId, isOwner }: { officeId: string; isOwner: boolean }) {
  const rooms = await roomsDal.listRooms(officeId).catch(() => null);
  if (!rooms || rooms.length > 0) return null;
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-4">
      <RoomsMissingAlert variant="missing" isOwner={isOwner} />
    </div>
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
      <RoomsBanner officeId={ctx.officeId} isOwner={ctx.role === "owner"} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
