"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import frLocale from "@fullcalendar/core/locales/fr";
import type { DateSelectArg, DatesSetArg, EventInput } from "@fullcalendar/core";

import "@/components/FullCalendarTheme.css";

import { t } from "@/lib/i18n";
import { fromKey, toKey } from "@/lib/calendar";
import { AVAILABILITIES_CHANGED } from "@/lib/availabilities-events";
import { Button, FormMessage } from "@/components/ui";

const TZ = "Europe/Paris";

interface Rule {
  weekday: number;
  startTime: string;
  endTime: string;
  roomId: string;
}
interface Exception {
  id: string;
  date: string;
  kind: string;
  startTime: string | null;
  endTime: string | null;
  fullDay: boolean;
  roomId: string | null;
}
interface Booking {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
}
interface MonthData {
  rules: Rule[];
  exceptions: Exception[];
  bookings: Booking[];
}

/** 0 = dimanche … 6 = samedi, vu à Paris. */
function weekdayParis(d: Date): number {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(d);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(short);
}

/**
 * Vue mensuelle des disponibilités : fond vert = ouvert, rouge = fermé,
 * événements = RDV. Sélection (clic ou glisser) : fermer / rouvrir.
 * `ssr: false` via import dynamique (voir page).
 */
export default function AvailabilityMonth({ practitionerId }: { practitionerId: string }) {
  const [data, setData] = useState<MonthData | null>(null);
  const [range, setRange] = useState<{ from: string; days: number } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Requêtes dédupliquées par plage : `datesSet` peut être réémis à chaque
  // rendu FullCalendar — sans garde, fetch → setState → rendu → boucle.
  // Seules les mutations forcent le rechargement (`force: true`).
  const lastFetched = useRef<string | null>(null);
  const inFlight = useRef<string | null>(null);
  const fetchRange = useCallback(async (from: string, days: number, force = false) => {
    const key = `${from}/${days}`;
    if (!force && (lastFetched.current === key || inFlight.current === key)) return;
    inFlight.current = key;
    try {
      const res = await fetch(`/api/disponibilites/month?from=${from}&days=${days}`);
      if (res.ok) {
        setData(await res.json());
        setRange({ from, days });
        lastFetched.current = key;
      }
    } finally {
      if (inFlight.current === key) inFlight.current = null;
    }
  }, []);

  // Recharge après les mutations de l'éditeur / de la liste d'exceptions.
  // Le miroir `ref` est synchronisé dans un effet (jamais pendant le rendu).
  const rangeRef = useRef(range);
  useEffect(() => {
    rangeRef.current = range;
  }, [range]);
  useEffect(() => {
    const handler = () => {
      const r = rangeRef.current;
      if (r) void fetchRange(r.from, r.days, true);
    };
    window.addEventListener(AVAILABILITIES_CHANGED, handler);
    return () => window.removeEventListener(AVAILABILITIES_CHANGED, handler);
  }, [fetchRange]);

  function onDatesSet(arg: DatesSetArg) {
    const from = toKey(arg.start);
    const days = Math.max(1, Math.round((arg.end.getTime() - arg.start.getTime()) / 86_400_000));
    void fetchRange(from, days);
  }

  const events: EventInput[] = useMemo(() => {
    if (!data || !range) return [];
    const out: EventInput[] = [];
    const offByDate = new Map<string, Exception[]>();
    for (const x of data.exceptions) {
      if (x.kind !== "off") continue;
      const list = offByDate.get(x.date) ?? [];
      list.push(x);
      offByDate.set(x.date, list);
    }
    const extraDates = new Set(data.exceptions.filter((x) => x.kind === "extra").map((x) => x.date));

    // Fond vert (ouvert) / rouge (fermé) sur chaque jour de la plage chargée.
    const base = fromKey(range.from);
    for (let i = 0; i < range.days; i++) {
      const d = new Date(base.getTime() + i * 86_400_000);
      const key = toKey(d);
      const open = data.rules.some((r) => r.weekday === weekdayParis(d)) || extraDates.has(key);
      const fullOff = (offByDate.get(key) ?? []).some((x) => x.fullDay);
      if (fullOff) {
        out.push({ start: key, end: key, display: "background", color: "rgba(239,68,68,0.20)" });
      } else if (open) {
        out.push({ start: key, end: key, display: "background", color: "rgba(34,197,94,0.14)" });
      }
    }
    // Fermetures partielle : bandeau rouge sur la plage horaire.
    for (const [date, list] of offByDate) {
      for (const x of list) {
        if (x.fullDay || !x.startTime || !x.endTime) continue;
        out.push({
          start: `${date}T${x.startTime}:00`,
          end: `${date}T${x.endTime}:00`,
          display: "background",
          color: "rgba(239,68,68,0.25)",
        });
      }
    }
    for (const b of data.bookings) {
      if (b.status === "cancelled") continue;
      // Pastille horaire sans libellé (vue mois uniquement).
      out.push({ id: b.id, start: b.startAt, end: b.endAt, title: "", color: "#18181b" });
    }
    return out;
  }, [data, range]);

  function dayState(key: string) {
    const offs = (data?.exceptions ?? []).filter((x) => x.date === key && x.kind === "off");
    const fullOff = offs.find((x) => x.fullDay);
    const bookings = (data?.bookings ?? []).filter(
      (b) => b.status !== "cancelled" && toKey(new Date(b.startAt)) === key,
    );
    return { fullOff, bookings };
  }

  async function toggleDay(key: string) {
    const { fullOff, bookings } = dayState(key);
    setHint(null);
    if (bookings.length > 0 && !fullOff) {
      setHint(t("availability.hasBookings", { n: bookings.length }));
      return;
    }
    setBusy(true);
    try {
      if (fullOff) {
        await fetch(`/api/exceptions/${fullOff.id}?practitionerId=${practitionerId}`, { method: "DELETE" });
      } else {
        const res = await fetch("/api/exceptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ practitionerId, date: key, kind: "off", fullDay: true }),
        });
        if (!res.ok) throw new Error();
      }
      if (range) await fetchRange(range.from, range.days, true);
    } catch {
      setHint(t("booking.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function closeRange(keys: string[]) {
    setBusy(true);
    setHint(null);
    let skipped = 0;
    try {
      for (const key of keys) {
        const { fullOff, bookings } = dayState(key);
        if (fullOff) continue;
        if (bookings.length > 0) {
          skipped++;
          continue;
        }
        await fetch("/api/exceptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ practitionerId, date: key, kind: "off", fullDay: true }),
        });
      }
      if (skipped > 0) setHint(t("availability.rangeSkipped", { n: skipped }));
      if (range) await fetchRange(range.from, range.days, true);
    } catch {
      setHint(t("booking.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  function onSelect(info: DateSelectArg) {
    // end exclusif → clés calendaires de la sélection.
    const keys: string[] = [];
    for (let d = new Date(info.start); d < info.end; d = new Date(d.getTime() + 86_400_000)) {
      keys.push(toKey(d));
    }
    info.view.calendar.unselect();
    if (busy) return;
    if (keys.length <= 1) void toggleDay(keys[0] ?? toKey(info.start));
    else void closeRange(keys);
  }

  return (
    <div>
      <p className="mb-2 text-xs text-zinc-500">{t("availability.calHint")}</p>
      <FullCalendar
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{ left: "prev,today,next", center: "title", right: "" }}
        locales={[frLocale]}
        locale="fr"
        timeZone={TZ}
        firstDay={1}
        height="auto"
        selectable
        selectMirror
        unselectAuto
        select={onSelect}
        datesSet={onDatesSet}
        events={events}
      />
      {busy ? (
        <div className="mt-3">
          <Button size="sm" disabled>
            {t("booking.loading")}
          </Button>
        </div>
      ) : null}
      <div className="mt-2">
        <FormMessage tone="error">{hint ?? ""}</FormMessage>
      </div>
    </div>
  );
}
