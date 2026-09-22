"use client";

import { useCallback, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import frLocale from "@fullcalendar/core/locales/fr";
import type { EventClickArg, EventContentArg, EventSourceFunc } from "@fullcalendar/core";

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
  roomName: string;
  roomColor: string | null;
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
  const [rooms, setRooms] = useState<{ id: string; name: string; color: string | null }[]>([]);

  function onEventClick(info: EventClickArg) {
    const p = info.event.extendedProps as Partial<Omit<Selected, "id" | "title" | "start" | "end">>;
    setSelected({
      id: info.event.id,
      title: info.event.title,
      start: info.event.start?.toISOString() ?? "",
      end: info.event.end?.toISOString() ?? "",
      status: p.status ?? "",
      paymentStatus: p.paymentStatus ?? "none",
      validationRequired: p.validationRequired ?? false,
      sessionName: p.sessionName ?? info.event.title,
      roomName: p.roomName ?? "",
      roomColor: p.roomColor ?? null,
      patientName: p.patientName ?? "",
      patientEmail: p.patientEmail ?? "",
      patientPhone: p.patientPhone ?? null,
      notes: p.notes ?? null,
      cancelToken: p.cancelToken ?? "",
    });
  }

  function refetch() {
    ref.current?.getApi().refetchEvents();
  }

  function renderEvent(arg: EventContentArg) {
    const p = arg.event.extendedProps as Partial<Selected>;
    const inList = arg.view.type.startsWith("list");
    return (
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate">{arg.event.title}</span>
        {p.roomColor ? (
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: p.roomColor }}
            title={p.roomName ?? ""}
          />
        ) : null}
        {inList && p.roomName ? <span className="shrink-0 opacity-80">· {p.roomName}</span> : null}
      </span>
    );
  }

  // Identité stable : évite une recharge à chaque rendu (sélection…).
  const fetchEvents: EventSourceFunc = useCallback(
    (fetchInfo, successCallback, failureCallback) => {
      fetch(`/api/agenda/events?start=${encodeURIComponent(fetchInfo.startStr)}&end=${encodeURIComponent(fetchInfo.endStr)}`)
        .then((r) => (r.ok ? r.json() : { events: [], rooms: [] }))
        .then((j) => {
          // Même référence si inchangé : évite un rendu (et donc une recharge).
          setRooms((prev) =>
            JSON.stringify(prev) === JSON.stringify(j.rooms ?? []) ? prev : (j.rooms ?? []),
          );
          successCallback(j.events ?? []);
        })
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
      {rooms.length > 0 ? (
        <div className="flex flex-wrap gap-3 text-sm">
          {rooms.map((r) => (
            <span key={r.id} className="inline-flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: r.color ?? "var(--faint)" }}
              />
              {r.name}
            </span>
          ))}
        </div>
      ) : null}
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
        eventContent={renderEvent}
      />
      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.sessionName ?? ""}
      >
        {selected ? (
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-mist">
              {selected.start ? fullFmt.format(new Date(selected.start)) : ""}
            </p>
            {selected.roomName ? (
              <p>
                {selected.roomColor ? (
                  <span
                    className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle"
                    style={{ backgroundColor: selected.roomColor }}
                  />
                ) : null}
                <span className="font-medium">{selected.roomName}</span>
              </p>
            ) : null}
            <p>
              {selected.patientName} · {selected.patientEmail}
              {selected.patientPhone ? ` · ${selected.patientPhone}` : ""}
            </p>
            {selected.notes ? <p className="text-mist">{selected.notes}</p> : null}
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
