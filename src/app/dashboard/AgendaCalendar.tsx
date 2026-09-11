"use client";

import { useCallback, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import frLocale from "@fullcalendar/core/locales/fr";
import type { EventClickArg, EventSourceFunc } from "@fullcalendar/core";

import "@/components/FullCalendarTheme.css";

import { t } from "@/lib/i18n";
import { Badge, Modal } from "@/components/ui";
import CancelBookingButton from "./CancelBookingButton";
import ValidateButtons from "./ValidateButtons";

const TZ = "Europe/Paris";
const fullFmt = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TZ,
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

interface Selected {
  id: string;
  title: string;
  start: string;
  end: string;
  status: string;
  paymentStatus: string;
  validationRequired: boolean;
  sessionName: string;
  patientName: string;
  patientEmail: string;
  patientPhone: string | null;
  notes: string | null;
  cancelToken: string;
}

/**
 * Agenda du praticien (Semaine / Mois / Liste). Clic sur un événement :
 * détail + annulation. `ssr: false` via import dynamique (voir page).
 */
export default function AgendaCalendar() {
  const ref = useRef<FullCalendar | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);

  function onEventClick(info: EventClickArg) {
    const p = info.event.extendedProps as Omit<Selected, "id" | "title" | "start" | "end">;
    setSelected({
      id: info.event.id,
      title: info.event.title,
      start: info.event.start?.toISOString() ?? "",
      end: info.event.end?.toISOString() ?? "",
      ...p,
    });
  }

  function refetch() {
    ref.current?.getApi().refetchEvents();
  }

  // Identité stable : évite une recharge à chaque rendu (sélection…).
  const fetchEvents: EventSourceFunc = useCallback(
    (fetchInfo, successCallback, failureCallback) => {
      fetch(`/api/agenda/events?start=${encodeURIComponent(fetchInfo.startStr)}&end=${encodeURIComponent(fetchInfo.endStr)}`)
        .then((r) => (r.ok ? r.json() : { events: [] }))
        .then((j) => successCallback(j.events ?? []))
        .catch(() => failureCallback(new Error("chargement impossible")));
    },
    [],
  );

  const statusTone = (status: string): "green" | "zinc" | "red" | "amber" =>
    status === "confirmed" ? "green" : status === "pending" ? "amber" : status === "completed" ? "zinc" : "red";
  const statusLabel = (status: string): string =>
    status === "confirmed"
      ? t("agenda.confirmed")
      : status === "pending"
        ? t("agenda.pending")
        : status === "completed"
          ? t("agenda.completed")
          : t("agenda.cancelledStatus");

  return (
    <div className="flex flex-col gap-4">
      <FullCalendar
        ref={ref}
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        headerToolbar={{ left: "prev,today,next", center: "title", right: "timeGridWeek,dayGridMonth,listWeek" }}
        locales={[frLocale]}
        locale="fr"
        timeZone={TZ}
        firstDay={1}
        slotMinTime="07:00:00"
        slotMaxTime="21:00:00"
        nowIndicator
        height="auto"
        noEventsText={t("agenda.empty")}
        events={fetchEvents}
        eventClick={onEventClick}
      />
      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.sessionName ?? ""}
      >
        {selected ? (
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-zinc-500">
              {selected.start ? fullFmt.format(new Date(selected.start)) : ""}
            </p>
            <p>
              {selected.patientName} · {selected.patientEmail}
              {selected.patientPhone ? ` · ${selected.patientPhone}` : ""}
            </p>
            {selected.notes ? <p className="text-zinc-500">{selected.notes}</p> : null}
            <p>
              <Badge tone={statusTone(selected.status)}>{statusLabel(selected.status)}</Badge>{" "}
              {selected.paymentStatus === "paid" ? (
                <Badge tone="blue">{t("agenda.paid")}</Badge>
              ) : null}
            </p>
            {selected.status === "pending" && selected.validationRequired ? (
              <ValidateButtons
                bookingId={selected.id}
                onDone={() => {
                  setSelected(null);
                  refetch();
                }}
              />
            ) : null}
            {selected.status === "confirmed" ? (
              <span>
                <CancelBookingButton
                  cancelToken={selected.cancelToken}
                  onDone={() => {
                    setSelected(null);
                    refetch();
                  }}
                />
              </span>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
