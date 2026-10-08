import type { EventInput } from "@fullcalendar/core";

import { TIMEZONE, fromKey, toKey } from "@/lib/calendar";

const DAY_MS = 86_400_000;

export interface Rule {
  weekday: number;
  startTime: string;
  endTime: string;
}

export interface Exception {
  id: string;
  date: string;
  kind: string;
  startTime: string | null;
  endTime: string | null;
  fullDay: boolean;
  roomId: string | null;
}

export interface MonthBooking {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
}

export interface MonthData {
  rules: Rule[];
  exceptions: Exception[];
  bookings: MonthBooking[];
  rooms: { id: string; name: string }[];
}

export interface MonthRange {
  from: string;
  days: number;
}

export interface DayState {
  fullOff: Exception | undefined;
  bookings: MonthBooking[];
  regularOpen: boolean;
  extras: Exception[];
  /** Fermetures partielles (ex. matinée) : gérées au clic comme les extras. */
  partialOffs: Exception[];
}

/** 0 = dimanche … 6 = samedi, vu à Paris. */
function weekdayParis(at: Date): number {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, weekday: "short" }).format(at);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(short);
}

export function dayState(data: MonthData, key: string): DayState {
  const onDay = data.exceptions.filter((exception) => exception.date === key);
  const weekday = weekdayParis(fromKey(key));
  return {
    fullOff: onDay.find((exception) => exception.kind === "off" && exception.fullDay),
    bookings: data.bookings.filter(
      (booking) => booking.status !== "cancelled" && toKey(new Date(booking.startAt)) === key,
    ),
    regularOpen: data.rules.some((rule) => rule.weekday === weekday),
    extras: onDay.filter((exception) => exception.kind === "extra"),
    partialOffs: onDay.filter((exception) => exception.kind === "off" && !exception.fullDay),
  };
}

/** Action explicite proposée au survol d'un jour (miroir de `toggleDay`). */
export type DayAction =
  | { kind: "reopen" }
  | { kind: "blocked"; count: number }
  | { kind: "openExtra" }
  | { kind: "cancelPartial"; ranges: string }
  | { kind: "cancelExtra" }
  | { kind: "close" };

export function dayAction(data: MonthData, key: string): DayAction {
  const state = dayState(data, key);
  // Un jour fermé reste rouvrable même avec des RDV (passés ou à venir).
  if (state.fullOff) return { kind: "reopen" };
  if (state.bookings.length > 0) return { kind: "blocked", count: state.bookings.length };
  if (!state.regularOpen && state.extras.length === 0) return { kind: "openExtra" };
  if (state.partialOffs.length > 0) {
    const ranges = state.partialOffs
      .map((exception) => `${exception.startTime ?? ""}→${exception.endTime ?? ""}`)
      .join(", ");
    return { kind: "cancelPartial", ranges };
  }
  if (!state.regularOpen) return { kind: "cancelExtra" };
  return { kind: "close" };
}

/** Règles hebdo s'appliquant au jour (couverture habituelle). */
export function dayRules(data: MonthData, key: string): Rule[] {
  const weekday = weekdayParis(fromKey(key));
  return data.rules.filter((rule) => rule.weekday === weekday);
}

/** Couverture habituelle du jour ([min, max]) ou null si jour fermé. */
export function dayCoverage(data: MonthData, key: string): { startTime: string; endTime: string } | null {
  const rules = dayRules(data, key);
  if (rules.length === 0) return null;
  return {
    startTime: rules.reduce((min, rule) => (rule.startTime < min ? rule.startTime : min), rules[0].startTime),
    endTime: rules.reduce((max, rule) => (rule.endTime > max ? rule.endTime : max), rules[0].endTime),
  };
}

/**
 * Fermetures partielles à créer pour ramener la couverture à `[start, end]`
 * (changement d'horaires du jour : ne rogne que l'intérieur des plages
 * habituelles, les trous entre deux plages restent intacts). Heures "HH:MM".
 */
export function trimOffs(
  rules: Rule[],
  start: string,
  end: string,
): { startTime: string; endTime: string }[] {
  const offs: { startTime: string; endTime: string }[] = [];
  for (const rule of rules) {
    if (start > rule.startTime) offs.push({ startTime: rule.startTime, endTime: start < rule.endTime ? start : rule.endTime });
    if (end < rule.endTime) offs.push({ startTime: end > rule.startTime ? end : rule.startTime, endTime: rule.endTime });
  }
  return offs.filter((off) => off.startTime < off.endTime);
}

/** Clés calendaires d'une sélection FullCalendar (`end` exclusif). */
export function selectionKeys(start: Date, end: Date): string[] {
  const keys: string[] = [];
  for (let at = new Date(start); at < end; at = new Date(at.getTime() + DAY_MS)) {
    keys.push(toKey(at));
  }
  return keys;
}

/** Plage entièrement hors horaires habituels → jours à ouvrir, sinon null (fermeture). */
export function openableOnly(data: MonthData, keys: string[]): string[] | null {
  const states = keys.map((key) => ({ key, state: dayState(data, key) }));
  const closable = states.filter(
    ({ state }) =>
      (state.regularOpen || state.extras.length > 0) && !state.fullOff && state.bookings.length === 0,
  );
  const openable = states.filter(
    ({ state }) => !state.regularOpen && state.extras.length === 0 && state.bookings.length === 0,
  );
  return openable.length > 0 && closable.length === 0 ? openable.map(({ key }) => key) : null;
}

/** Fond vert (ouvert) / rouge (fermé), fermetures partielles et pastilles de RDV. */
export function buildMonthEvents(data: MonthData, range: MonthRange): EventInput[] {
  const events: EventInput[] = [];
  const base = fromKey(range.from);
  for (let index = 0; index < range.days; index++) {
    const key = toKey(new Date(base.getTime() + index * DAY_MS));
    const state = dayState(data, key);
    if (state.fullOff) {
      events.push({ start: key, end: key, display: "background", color: "var(--danger-bg)" });
    } else if (state.regularOpen || state.extras.length > 0) {
      events.push({ start: key, end: key, display: "background", color: "var(--brand-soft)" });
    }
  }
  for (const exception of data.exceptions) {
    if (exception.kind !== "off" || exception.fullDay || !exception.startTime || !exception.endTime) continue;
    events.push({
      start: `${exception.date}T${exception.startTime}:00`,
      end: `${exception.date}T${exception.endTime}:00`,
      display: "background",
      color: "var(--danger-bg)",
    });
  }
  for (const booking of data.bookings) {
    if (booking.status === "cancelled") continue;
    // Pastille horaire sans libellé (vue mois uniquement).
    events.push({ id: booking.id, start: booking.startAt, end: booking.endAt, title: "", color: "var(--brand)" });
  }
  return events;
}
