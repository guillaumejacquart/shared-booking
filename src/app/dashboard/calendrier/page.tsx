import { t } from "@/lib/i18n";
import { services } from "@/lib/container";
import SharedCalendarLoader from "./SharedCalendarLoader";
import { getDashboardContext } from "@/lib/dashboard";

export default async function SharedCalendarPage() {
  const ctx = await getDashboardContext(); // garde : connecté + membre d'un cabinet
  const formData = await services.bookings.manualFormData(ctx.userId);
  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">{t("sharedCalendar.title")}</h1>
      <p className="mb-4 text-sm text-mist">{t("sharedCalendar.subtitle")}</p>
      <SharedCalendarLoader formData={formData} />
    </div>
  );
}
