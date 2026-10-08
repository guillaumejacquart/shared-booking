import { services } from "@/lib/container";
import { getDashboardContext } from "@/lib/dashboard";
import { t } from "@/lib/i18n";
import ReservationsList from "./ReservationsList";

/**
 * Mes réservations : demandes en attente de validation + confirmées à
 * venir (vue centralisée, complément de l'agenda calendaire).
 */
export default async function ReservationsPage() {
  const ctx = await getDashboardContext();
  const { pending, upcoming } = await services.calendar.reservations({
    userId: ctx.userId,
    now: new Date(),
  });
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">{t("reservations.title")}</h1>
      <ReservationsList pending={pending} upcoming={upcoming} timezone={ctx.officeTimezone} />
    </div>
  );
}
