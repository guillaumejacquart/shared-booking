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
import { fullFmt } from "@/lib/format";
import { Badge, Modal } from "@/components/ui";
import CancelBookingButton from "./CancelBookingButton";
import ValidateButtons from "./ValidateButtons";

const TZ = "Europe/Paris";

interface PractitionerLegend {
  id: string;
  displayName: string;
  color: string;
}

interface RoomLegend {
  id: string;
  name: string;
  color: string | null;
}

interface Selected {
  id: string;
  status: string;
  validationRequired: boolean;
  practitionerName: string;
  practitionerColor: string;
  roomName: string;
  roomColor: string | null;
  sessionName: string;
  start: string;
  end: string;
  mine: boolean;
  patientName: string | null;
  patientEmail: string | null;
  patientPhone: string | null;
  cancelToken: string | null;
}

/** Initiales pour la pastille praticien (ex. "Marie Curie" → "MC"). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Calendrier partagé : couleur = praticien (légende), pastille = salle,
 * noms masqués hors owner/soi. Clic : détail en modale.
 * `ssr: false` via import dynamique (voir page).
 */
export default function SharedCalendar() {
  const [practitioners, setPractitioners] = useState<PractitionerLegend[]>([]);
  const [rooms, setRooms] = useState<RoomLegend[]>([]);
  const [selected, setSelected] = useState<Selected | null>(null);
  const ref = useRef<FullCalendar | null>(null);

  // Identité stable : sinon FullCalendar voit une nouvelle source d'événements
  // à chaque rendu et recharge en boucle.
  const fetchEvents: EventSourceFunc = useCallback(
    (fetchInfo, successCallback, failureCallback) => {
      fetch(
        `/api/calendrier/events?start=${encodeURIComponent(fetchInfo.startStr)}&end=${encodeURIComponent(fetchInfo.endStr)}`,
      )
        .then((r) => (r.ok ? r.json() : { events: [], practitioners: [], rooms: [] }))
        .then((j) => {
          // Même référence si inchangé : évite un rendu (et donc une recharge).
          setPractitioners((prev) =>
            JSON.stringify(prev) === JSON.stringify(j.practitioners ?? [])
              ? prev
              : (j.practitioners ?? []),
          );
          setRooms((prev) =>
            JSON.stringify(prev) === JSON.stringify(j.rooms ?? []) ? prev : (j.rooms ?? []),
          );
          successCallback(j.events ?? []);
        })
        .catch(() => failureCallback(new Error("chargement impossible")));
    },
    [],
  );

  function onEventClick(info: EventClickArg) {
    const p = info.event.extendedProps as Omit<Selected, "id" | "start" | "end">;
    setSelected({
      id: info.event.id,
      start: info.event.start?.toISOString() ?? "",
      end: info.event.end?.toISOString() ?? "",
      ...p,
    });
  }

  function renderEvent(arg: EventContentArg) {
    const p = arg.event.extendedProps as Partial<Selected>;
    const inList = arg.view.type.startsWith("list");
    return (
      <span className="flex min-w-0 items-center gap-1">
        <span
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
          style={{ backgroundColor: "rgba(0,0,0,0.35)" }}
          title={p.practitionerName ?? ""}
        >
          {initials(p.practitionerName ?? "?")}
        </span>
        <span className="truncate">{arg.event.title}</span>
        {inList && p.practitionerName ? (
          <span className="shrink-0 opacity-80">· {p.practitionerName}</span>
        ) : null}
        {p.roomColor ? (
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: p.roomColor }}
            title={p.roomName ?? ""}
          />
        ) : null}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {practitioners.length > 0 || rooms.length > 0 ? (
        <div className="flex flex-col gap-2 text-sm">
          {practitioners.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {practitioners.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1.5">
                  <span
                    className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ backgroundColor: p.color }}
                  >
                    {initials(p.displayName)}
                  </span>
                  {p.displayName}
                </span>
              ))}
            </div>
          ) : null}
          {rooms.length > 0 ? (
            <div className="flex flex-wrap gap-3">
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
            <p>
              <span
                className="mr-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={{ backgroundColor: selected.practitionerColor }}
              >
                {initials(selected.practitionerName)}
              </span>{" "}
              <span className="font-medium">{selected.practitionerName}</span>
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
            {selected.patientName ? (
              <p>
                {selected.patientName}
                {selected.patientEmail ? ` · ${selected.patientEmail}` : ""}
                {selected.patientPhone ? ` · ${selected.patientPhone}` : ""}
              </p>
            ) : (
              <p className="text-mist">{t("sharedCalendar.masked")}</p>
            )}
            {selected.mine ? (
              <p>
                <Badge tone="zinc">{t("agenda.mine")}</Badge>
              </p>
            ) : null}
            {selected.mine && selected.status === "pending" && selected.validationRequired ? (
              <ValidateButtons
                bookingId={selected.id}
                onDone={() => {
                  setSelected(null);
                  ref.current?.getApi().refetchEvents();
                }}
              />
            ) : null}
            {selected.mine && selected.status === "confirmed" && selected.cancelToken ? (
              <span>
                <CancelBookingButton
                  cancelToken={selected.cancelToken}
                  onDone={() => {
                    setSelected(null);
                    ref.current?.getApi().refetchEvents();
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
