import { services } from "@/lib/container";
import { getDashboardContext } from "@/lib/dashboard";
import { t } from "@/lib/i18n";
import NewBookingButton from "./NewBookingButton";
import ReservationsList from "./ReservationsList";

/**
 * Mes réservations : demandes en attente de validation + confirmées à
 * venir (vue centralisée, complément de l'agenda calendaire).
 */
export default async function ReservationsPage() {
  const ctx = await getDashboardContext();
  const [{ pending, upcoming }, formData] = await Promise.all([
    services.calendar.reservations({ userId: ctx.userId, now: new Date() }),
    services.bookings.manualFormData(ctx.userId),
  ]);
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("reservations.title")}</h1>
        <NewBookingButton formData={formData} />
      </div>
      <ReservationsList pending={pending} upcoming={upcoming} timezone={ctx.officeTimezone} />
    </div>
  );
}
