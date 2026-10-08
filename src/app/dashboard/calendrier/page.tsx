import * as roomsDal from "@/dal/rooms";
import { t } from "@/lib/i18n";
import { services } from "@/lib/container";
import RoomsMissingAlert from "@/components/RoomsMissingAlert";
import SharedCalendarLoader from "./SharedCalendarLoader";
import { getDashboardContext } from "@/lib/dashboard";

export default async function SharedCalendarPage() {
  const ctx = await getDashboardContext(); // garde : connecté + membre d'un cabinet
  const [formData, officeRooms] = await Promise.all([
    services.bookings.manualFormData(ctx.userId),
    roomsDal.listRooms(ctx.officeId),
  ]);
  // Salles au cabinet mais aucune attribuée au praticien : sans salle, aucun
  // créneau n'est réservable (ni ici en saisie manuelle, ni côté public).
  // Zéro salle au cabinet → le bandeau global du layout l'a déjà signalé.
  const showUnassigned = formData.rooms.length === 0 && officeRooms.length > 0;
  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">{t("sharedCalendar.title")}</h1>
      <p className="mb-4 text-sm text-mist">{t("sharedCalendar.subtitle")}</p>
      {showUnassigned ? (
        <div className="mb-4">
          <RoomsMissingAlert variant="unassigned" isOwner={ctx.role === "owner"} />
        </div>
      ) : null}
      <SharedCalendarLoader formData={formData} />
    </div>
  );
}
