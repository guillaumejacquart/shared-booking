"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import frLocale from "@fullcalendar/core/locales/fr";
import type { DateSelectArg, DatesSetArg } from "@fullcalendar/core";

import "@/components/FullCalendarTheme.css";

import { t } from "@/lib/i18n";
import { TIMEZONE, toKey } from "@/lib/calendar";
import { AVAILABILITIES_CHANGED } from "@/lib/availabilities-events";
import { Button, FormMessage } from "@/components/ui";
import OpeningForm from "@/components/availability/OpeningForm";
import { closeDay, deleteException, openDay, type Opening } from "@/components/availability/exceptions-api";
import {
  buildMonthEvents,
  dayState,
  openableOnly,
  selectionKeys,
  type MonthData,
  type MonthRange,
} from "@/components/availability/month-model";

/**
 * Vue mensuelle des disponibilités : fond vert = ouvert, rouge = fermé,
 * événements = RDV. Sélection (clic ou glisser) : fermer / rouvrir.
 * `ssr: false` via import dynamique (voir page).
 */
export default function AvailabilityMonth({ practitionerId }: { practitionerId: string }) {
  const router = useRouter();
  const [data, setData] = useState<MonthData | null>(null);
  const [range, setRange] = useState<MonthRange | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Sélection fermée en attente d'ouverture exceptionnelle (horaires + salle).
  const [pendingOpen, setPendingOpen] = useState<string[] | null>(null);

  // `datesSet` peut être réémis à chaque rendu FullCalendar : sans
  // déduplication par plage, fetch → setState → rendu → boucle.
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
  const rangeRef = useRef(range);
  useEffect(() => {
    rangeRef.current = range;
  }, [range]);
  useEffect(() => {
    const handler = () => {
      const current = rangeRef.current;
      if (current) void fetchRange(current.from, current.days, true);
    };
    window.addEventListener(AVAILABILITIES_CHANGED, handler);
    return () => window.removeEventListener(AVAILABILITIES_CHANGED, handler);
  }, [fetchRange]);

  const events = useMemo(() => (data && range ? buildMonthEvents(data, range) : []), [data, range]);

  function onDatesSet(arg: DatesSetArg) {
    const days = Math.max(1, Math.round((arg.end.getTime() - arg.start.getTime()) / 86_400_000));
    void fetchRange(toKey(arg.start), days);
  }

  /** Recharge la vue et la liste d'exceptions rendue côté serveur. */
  async function refresh() {
    if (range) await fetchRange(range.from, range.days, true);
    router.refresh();
  }

  async function withBusy(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch {
      setHint(t("booking.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  function startOpening(keys: string[]) {
    setPendingOpen(keys);
    setHint(null);
  }

  async function toggleDay(monthData: MonthData, key: string) {
    const { fullOff, bookings, regularOpen, extras } = dayState(monthData, key);
    setHint(null);
    setPendingOpen(null);
    if (bookings.length > 0 && !fullOff) {
      setHint(t("availability.hasBookings", { n: bookings.length }));
      return;
    }
    // Jour hors horaires habituels : propose une ouverture exceptionnelle.
    if (!fullOff && !regularOpen && extras.length === 0) {
      startOpening([key]);
      return;
    }
    await withBusy(async () => {
      if (fullOff) {
        // Rouvre : supprime la fermeture (les ouvertures éventuelles restent).
        await deleteException(practitionerId, fullOff.id);
      } else if (!regularOpen) {
        // Annule l'ouverture exceptionnelle au lieu d'empiler une fermeture.
        for (const extra of extras) await deleteException(practitionerId, extra.id);
      } else if (!(await closeDay(practitionerId, key))) {
        throw new Error("close failed");
      }
      await refresh();
    });
  }

  async function closeRange(monthData: MonthData, keys: string[]) {
    setHint(null);
    await withBusy(async () => {
      const counts = { skipped: 0, alreadyClosed: 0, changed: 0 };
      for (const key of keys) {
        const { fullOff, bookings, regularOpen, extras } = dayState(monthData, key);
        if (fullOff) continue;
        if (bookings.length > 0) counts.skipped++;
        else if (!regularOpen && extras.length > 0) {
          for (const extra of extras) await deleteException(practitionerId, extra.id);
          counts.changed++;
        } else if (!regularOpen) counts.alreadyClosed++;
        else if (await closeDay(practitionerId, key)) counts.changed++;
      }
      const hints: string[] = [];
      if (counts.skipped > 0) hints.push(t("availability.rangeSkipped", { n: counts.skipped }));
      if (counts.alreadyClosed > 0) hints.push(t("availability.rangeClosedSkipped", { n: counts.alreadyClosed }));
      if (hints.length > 0) setHint(hints.join(" "));
      if (counts.changed > 0) await refresh();
    });
  }

  async function createOpenings(monthData: MonthData, keys: string[], opening: Opening) {
    setHint(null);
    if (opening.startTime >= opening.endTime) {
      setHint(t("availability.invalidHours"));
      return;
    }
    if (!opening.roomId) {
      setHint(t("availability.needRoom"));
      return;
    }
    await withBusy(async () => {
      let skipped = 0;
      let created = 0;
      for (const key of keys) {
        const { fullOff, bookings, extras } = dayState(monthData, key);
        if (bookings.length > 0 || extras.length > 0) {
          skipped++;
          continue;
        }
        // Une fermeture restante continuerait de bloquer les créneaux.
        if (fullOff) await deleteException(practitionerId, fullOff.id);
        if (!(await openDay(practitionerId, key, opening))) throw new Error("open failed");
        created++;
      }
      if (skipped > 0 && created === 0) setHint(t("availability.alreadyOpen"));
      else if (skipped > 0) setHint(t("availability.rangeSkipped", { n: skipped }));
      if (created > 0) await refresh();
      setPendingOpen(null);
    });
  }

  function onSelect(info: DateSelectArg) {
    const keys = selectionKeys(info.start, info.end);
    info.view.calendar.unselect();
    if (busy || !data) return;
    if (keys.length <= 1) {
      void toggleDay(data, keys[0] ?? toKey(info.start));
      return;
    }
    // Plage entièrement hors horaires → ouverture plutôt que fermetures sans effet.
    const toOpen = openableOnly(data, keys);
    if (toOpen) {
      startOpening(toOpen);
      return;
    }
    setPendingOpen(null);
    void closeRange(data, keys);
  }

  return (
    <div>
      <p className="mb-2 text-xs text-mist">{t("availability.calHint")}</p>
      <FullCalendar
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{ left: "prev,today,next", center: "title", right: "" }}
        locales={[frLocale]}
        locale="fr"
        timeZone={TIMEZONE}
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
      {pendingOpen && data ? (
        <OpeningForm
          key={pendingOpen.join()}
          dayKeys={pendingOpen}
          rooms={data.rooms}
          initial={{
            startTime: data.rules[0]?.startTime ?? "09:00",
            endTime: data.rules[0]?.endTime ?? "18:00",
            roomId: data.rooms[0]?.id ?? "",
          }}
          busy={busy}
          onSubmit={(opening) => void createOpenings(data, pendingOpen, opening)}
          onCancel={() => setPendingOpen(null)}
        />
      ) : null}
      <div className="mt-2">
        <FormMessage tone="error">{hint ?? ""}</FormMessage>
      </div>
    </div>
  );
}
