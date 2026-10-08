import { t } from "@/lib/i18n";
import SharedCalendarLoader from "./SharedCalendarLoader";
import { getDashboardContext } from "@/lib/dashboard";

export default async function SharedCalendarPage() {
  await getDashboardContext(); // garde : connecté + membre d'un cabinet
  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">{t("sharedCalendar.title")}</h1>
      <p className="mb-4 text-sm text-mist">{t("sharedCalendar.subtitle")}</p>
      <SharedCalendarLoader />
    </div>
  );
}
