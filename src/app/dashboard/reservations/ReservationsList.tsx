"use client";

import { useRouter } from "next/navigation";

import type { ReservationItem } from "@/services/calendar";
import { t } from "@/lib/i18n";
import { Badge } from "@/components/ui";
import CancelBookingButton from "../CancelBookingButton";
import ValidateButtons from "../ValidateButtons";

/**
 * Vue centralisée des réservations : demandes à valider puis confirmées à
 * venir, en tableau compact (40 RDV restent lisibles). Les actions
 * réutilisent les boutons de l'agenda ; `refresh` recharge les données
 * serveur après chaque action.
 */
export default function ReservationsList({
  pending,
  upcoming,
  timezone,
}: {
  pending: ReservationItem[];
  upcoming: ReservationItem[];
  timezone: string;
}) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const dayFmt = new Intl.DateTimeFormat("fr-FR", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const timeFmt = new Intl.DateTimeFormat("fr-FR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  });

  function whenOf(item: ReservationItem): string {
    const start = new Date(item.startAt);
    const end = new Date(item.endAt);
    return `${dayFmt.format(start)} · ${timeFmt.format(start)}–${timeFmt.format(end)}`;
  }

  function renderTable(
    items: ReservationItem[],
    actionable: "validate" | "cancel",
    emptyKey: string,
  ) {
    if (items.length === 0) {
      return <p className="text-sm text-mist">{t(emptyKey)}</p>;
    }
    return (
      <div className="overflow-x-auto rounded-3xl border border-line bg-card shadow-soft">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-mist">
              <th scope="col" className="whitespace-nowrap px-4 py-2.5 font-medium">
                {t("reservations.colWhen")}
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                {t("reservations.colSession")}
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                {t("reservations.colPatient")}
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                {t("reservations.colRoom")}
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                {t("reservations.colStatus")}
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                <span className="sr-only">{t("reservations.colActions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-line align-top last:border-0">
                <td className="whitespace-nowrap px-4 py-2.5">{whenOf(item)}</td>
                <td className="px-4 py-2.5 font-medium">{item.sessionName}</td>
                <td className="px-4 py-2.5">
                  {item.patientName}
                  <span className="block text-xs text-mist">
                    {item.patientEmail}
                    {item.patientPhone ? ` · ${item.patientPhone}` : ""}
                  </span>
                  {item.notes ? (
                    <span className="block text-xs text-mist italic">{item.notes}</span>
                  ) : null}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5">{item.roomName}</td>
                <td className="whitespace-nowrap px-4 py-2.5">
                  {actionable === "validate" ? (
                    <Badge tone="amber">{t("agenda.pending")}</Badge>
                  ) : (
                    <Badge tone="green">{t("agenda.confirmed")}</Badge>
                  )}{" "}
                  {item.paymentStatus === "paid" ? (
                    <Badge tone="blue">{t("reservations.paid")}</Badge>
                  ) : null}
                </td>
                <td className="px-4 py-2.5">
                  {actionable === "validate" ? (
                    <ValidateButtons bookingId={item.id} onDone={refresh} />
                  ) : (
                    <CancelBookingButton cancelToken={item.cancelToken} onDone={refresh} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-3 text-lg font-semibold">
          {t("reservations.pendingTitle")}
          {pending.length > 0 ? ` (${pending.length})` : ""}
        </h2>
        {renderTable(pending, "validate", "reservations.pendingEmpty")}
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold">
          {t("reservations.upcomingTitle")}
          {upcoming.length > 0 ? ` (${upcoming.length})` : ""}
        </h2>
        {renderTable(upcoming, "cancel", "reservations.upcomingEmpty")}
      </section>
    </div>
  );
}
