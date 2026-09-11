import { getDashboardContext } from "@/lib/dashboard";
import { t } from "@/lib/i18n";
import SharedCalendarLoader from "./SharedCalendarLoader";

export default async function SharedCalendarPage() {
  await getDashboardContext(); // garde : connecté + membre d'un cabinet
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">{t("sharedCalendar.title")}</h1>
      <SharedCalendarLoader />
    </div>
  );
}
