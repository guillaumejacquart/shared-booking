import { getDashboardContext } from "@/lib/dashboard";
import { t } from "@/lib/i18n";
import { Badge } from "@/components/ui";
import AgendaCalendarLoader from "./AgendaCalendarLoader";

export default async function AgendaPage() {
  await getDashboardContext(); // garde : connecté + membre d'un cabinet
  return (
    <div>
      <h1 className="mb-3 text-xl font-semibold">{t("agenda.title")}</h1>
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone="green">{t("agenda.confirmed")}</Badge>
        <Badge tone="amber">{t("agenda.pending")}</Badge>
        <Badge tone="zinc">{t("agenda.completed")}</Badge>
        <Badge tone="red">{t("agenda.cancelledStatus")}</Badge>
      </div>
      <AgendaCalendarLoader />
    </div>
  );
}
