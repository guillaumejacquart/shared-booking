"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import frLocale from "@fullcalendar/core/locales/fr";
import type { DateSelectArg, DatesSetArg, DayCellContentArg } from "@fullcalendar/core";

import "@/components/FullCalendarTheme.css";

import { t } from "@/lib/i18n";
import { TIMEZONE, fromKey, toKey } from "@/lib/calendar";
import { AVAILABILITIES_CHANGED } from "@/lib/availabilities-events";
import { Button, FormMessage, Modal } from "@/components/ui";
import OpeningForm from "@/components/availability/OpeningForm";
import DayHoursForm, { type DayHours } from "@/components/availability/DayHoursForm";
import { closeDay, createPartialOff, deleteException, openDay, type Opening } from "@/components/availability/exceptions-api";
import {
  buildMonthEvents,
  dayAction,
  dayCoverage,
  dayRules,
  dayState,
  openableOnly,
  selectionKeys,
  trimOffs,
  type DayAction,
  type MonthData,
  type MonthRange,
} from "@/components/availability/month-model";

/** Empêche FullCalendar de démarrer une sélection depuis le bouton Horaires. */
function stopEvent(event: SyntheticEvent): void {
  event.stopPropagation();
}

const dayLabelFmt = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TIMEZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** "2026-09-14" → "lun. 14 sept." (Europe/Paris). */
function dayLabel(key: string): string {
  return dayLabelFmt.format(fromKey(key));
}

/** Libellé de l'action révélée au survol d'un jour (pastille non cliquable). */
function actionLabel(action: DayAction): string {
  switch (action.kind) {
    case "close":
      return t("availability.closeDay");
    case "reopen":
      return t("availability.reopenDay");
    case "openExtra":
      return t("availability.openExtra");
    case "cancelExtra":
      return t("availability.cancelExtra");
    case "cancelPartial":
      return t("availability.cancelPartial", { ranges: action.ranges });
    case "blocked":
      return t("availability.dayBlocked", { n: action.count });
  }
}

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
  // Erreur affichée dans la modale (validation du formulaire ouvert).
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Sélection fermée en attente d'ouverture exceptionnelle (horaires + salle).
  const [pendingOpen, setPendingOpen] = useState<string[] | null>(null);
  // Jour ouvert en attente de changement d'horaires (fermetures partielles).
  const [pendingHours, setPendingHours] = useState<string | null>(null);

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
  const hoursCoverage = pendingHours && data ? dayCoverage(data, pendingHours) : null;

  // Pastille d'action explicite révélée au survol + bouton Horaires
  // (cliquable : `stopEvent` en capture bloque la sélection FullCalendar).
  // Les pastilles sont en `pointer-events: none` sauf le bouton : le clic
  // sur la pastille traverse vers la case (sélection habituelle).
  const renderDayContent = useCallback(
    (arg: DayCellContentArg) => {
      if (!data) {
        return (
          <div className="avail-day-top">
            <span className="fc-daygrid-day-number">{arg.dayNumberText}</span>
          </div>
        );
      }
      const key = toKey(arg.date);
      const action = dayAction(data, key);
      const state = dayState(data, key);
      const editableHours =
        state.regularOpen && state.extras.length === 0 && state.bookings.length === 0 && !state.fullOff;
      return (
        <div className="avail-day-top">
          <span className="fc-daygrid-day-number">{arg.dayNumberText}</span>
          <span className="avail-day-action" data-kind={action.kind} aria-hidden="true">
            {actionLabel(action)}
          </span>
          {editableHours ? (
            <button
              type="button"
              className="avail-day-hours"
              onMouseDownCapture={stopEvent}
              onPointerDownCapture={stopEvent}
              onTouchStartCapture={stopEvent}
              onClick={(event) => {
                event.stopPropagation();
                setPendingOpen(null);
                setFormError(null);
                setHint(null);
                setPendingHours(key);
              }}
            >
              {t("availability.editHours")}
            </button>
          ) : null}
        </div>
      );
    },
    [data],
  );

  function onDatesSet(arg: DatesSetArg) {
    const days = Math.max(1, Math.round((arg.end.getTime() - arg.start.getTime()) / 86_400_000));
    void fetchRange(toKey(arg.start), days);
  }

  /** Recharge la vue et la liste d'exceptions rendue côté serveur. */
  async function refresh() {
    if (range) await fetchRange(range.from, range.days, true);
    router.refresh();
  }

  async function withBusy(action: () => Promise<void>, setError: (message: string) => void = setHint) {
    setBusy(true);
    try {
      await action();
    } catch {
      setError(t("booking.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  function startOpening(keys: string[]) {
    setPendingOpen(keys);
    setPendingHours(null);
    setFormError(null);
    setHint(null);
  }

  function closeOpening() {
    setPendingOpen(null);
    setFormError(null);
  }

  function closeHours() {
    setPendingHours(null);
    setFormError(null);
  }

  async function toggleDay(monthData: MonthData, key: string) {
    const { fullOff, bookings, regularOpen, extras, partialOffs } = dayState(monthData, key);
    setHint(null);
    setPendingOpen(null);
    setPendingHours(null);
    if (bookings.length > 0 && !fullOff) {
      setHint(t("availability.blockedHint", { n: bookings.length }));
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
      } else if (partialOffs.length > 0) {
        // Annule la fermeture partielle (un 2e clic fermera tout le jour).
        for (const partial of partialOffs) await deleteException(practitionerId, partial.id);
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
        const { fullOff, bookings, regularOpen, extras, partialOffs } = dayState(monthData, key);
        if (fullOff) continue;
        if (bookings.length > 0) counts.skipped++;
        else if (!regularOpen && extras.length > 0) {
          for (const extra of extras) await deleteException(practitionerId, extra.id);
          counts.changed++;
        } else if (!regularOpen) counts.alreadyClosed++;
        else {
          // Évite d'empiler une fermeture totale sur des partielles orphelines.
          for (const partial of partialOffs) await deleteException(practitionerId, partial.id);
          if (await closeDay(practitionerId, key)) counts.changed++;
        }
      }
      const hints: string[] = [];
      if (counts.skipped > 0) hints.push(t("availability.rangeSkipped", { n: counts.skipped }));
      if (counts.alreadyClosed > 0) hints.push(t("availability.rangeClosedSkipped", { n: counts.alreadyClosed }));
      if (hints.length > 0) setHint(hints.join(" "));
      if (counts.changed > 0) await refresh();
    });
  }

  async function createOpenings(monthData: MonthData, keys: string[], opening: Opening) {
    setFormError(null);
    if (opening.startTime >= opening.endTime) {
      setFormError(t("availability.invalidHours"));
      return;
    }
    if (!opening.roomId) {
      setFormError(t("availability.needRoom"));
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
      closeOpening();
    }, setFormError);
  }

  /** Change les horaires d'un jour ouvert via des fermetures partielles. */
  async function applyHours(monthData: MonthData, key: string, hours: DayHours) {
    setFormError(null);
    if (hours.startTime >= hours.endTime) {
      setFormError(t("availability.invalidHours"));
      return;
    }
    const coverage = dayCoverage(monthData, key);
    if (!coverage) {
      closeHours();
      return;
    }
    // On ne peut que rogner : élargir passe par les horaires hebdo ci-dessus.
    if (hours.startTime < coverage.startTime || hours.endTime > coverage.endTime) {
      setFormError(
        t("availability.hoursBeyondHabitual", {
          ranges: `${coverage.startTime}→${coverage.endTime}`,
        }),
      );
      return;
    }
    await withBusy(async () => {
      // Repart des horaires habituels : remplace les partielles existantes.
      const { partialOffs } = dayState(monthData, key);
      for (const partial of partialOffs) await deleteException(practitionerId, partial.id);
      const offs = trimOffs(dayRules(monthData, key), hours.startTime, hours.endTime);
      if (offs.length === 0 && partialOffs.length === 0) {
        closeHours();
        return;
      }
      for (const off of offs) {
        if (!(await createPartialOff(practitionerId, key, off.startTime, off.endTime))) {
          throw new Error("partial off failed");
        }
      }
      await refresh();
      closeHours();
    }, setFormError);
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
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mist">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-3 w-3 rounded border border-line"
            style={{ backgroundColor: "var(--brand-soft)" }}
            aria-hidden="true"
          />
          {t("availability.legendOpen")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-3 w-3 rounded border border-line"
            style={{ backgroundColor: "var(--danger-bg)" }}
            aria-hidden="true"
          />
          {t("availability.legendClosed")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2 w-6 rounded-full"
            style={{ backgroundColor: "var(--danger-bg)" }}
            aria-hidden="true"
          />
          {t("availability.legendPartial")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-6 rounded-full" style={{ backgroundColor: "var(--brand)" }} aria-hidden="true" />
          {t("availability.legendBooking")}
        </span>
      </div>
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
        dayCellContent={renderDayContent}
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
        <Modal
          open
          onClose={closeOpening}
          title={`${t("availability.openTitle")} · ${
            pendingOpen.length === 1
              ? dayLabel(pendingOpen[0] ?? "")
              : t("availability.openDays", {
                  first: dayLabel(pendingOpen[0] ?? ""),
                  last: dayLabel(pendingOpen[pendingOpen.length - 1] ?? ""),
                  n: pendingOpen.length,
                })
          }`}
        >
          <OpeningForm
            key={pendingOpen.join()}
            rooms={data.rooms}
            initial={{
              startTime: data.rules[0]?.startTime ?? "09:00",
              endTime: data.rules[0]?.endTime ?? "18:00",
              roomId: data.rooms[0]?.id ?? "",
            }}
            busy={busy}
            error={formError}
            onSubmit={(opening) => void createOpenings(data, pendingOpen, opening)}
            onCancel={closeOpening}
          />
        </Modal>
      ) : null}
      {pendingHours && data && hoursCoverage ? (
        <Modal
          open
          onClose={closeHours}
          title={t("availability.hoursTitle", { date: dayLabel(pendingHours) })}
        >
          <DayHoursForm
            key={pendingHours}
            habitual={`${hoursCoverage.startTime} → ${hoursCoverage.endTime}`}
            initial={{ startTime: hoursCoverage.startTime, endTime: hoursCoverage.endTime }}
            busy={busy}
            error={formError}
            onSubmit={(hours) => void applyHours(data, pendingHours, hours)}
            onCancel={closeHours}
          />
        </Modal>
      ) : null}
      <div className="mt-2">
        <FormMessage tone="error">{hint ?? ""}</FormMessage>
      </div>
    </div>
  );
}
