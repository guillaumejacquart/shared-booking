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
  | { kind: "editExtra" }
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
  if (!state.regularOpen) return { kind: "editExtra" };
  return { kind: "close" };
}

/** Créneaux affichés dans la case d'un jour : effectifs (règles − partielles) + ouvertures. */
export function daySlots(data: MonthData, key: string): TimeSlot[] {
  const state = dayState(data, key);
  if (state.fullOff) return [];
  const regular = state.regularOpen ? effectiveSlots(data, key) : [];
  const extras = state.extras
    .map((exception) => ({
      startTime: exception.startTime ?? "",
      endTime: exception.endTime ?? "",
    }))
    .filter((slot) => slot.startTime !== "" && slot.startTime < slot.endTime);
  return [...regular, ...extras].sort(
    (first, second) =>
      first.startTime.localeCompare(second.startTime) || first.endTime.localeCompare(second.endTime),
  );
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

/** Plage horaire simple (lignes de la modale multi-créneaux). */
export interface TimeSlot {
  startTime: string;
  endTime: string;
}

/**
 * Différence ensembliste `base` moins `cuts` (heures "HH:MM" triées en sortie).
 * Sert aux deux sens : créneaux effectifs (règles − partielles) et
 * fermetures à créer (règles − créneaux voulus).
 */
function subtract(base: TimeSlot[], cuts: TimeSlot[]): TimeSlot[] {
  const ordered = [...cuts].sort(
    (first, second) =>
      first.startTime.localeCompare(second.startTime) || first.endTime.localeCompare(second.endTime),
  );
  const kept: TimeSlot[] = [];
  for (const interval of base) {
    let cursor = interval.startTime;
    for (const cut of ordered) {
      if (cut.endTime <= cursor) continue;
      if (cut.startTime >= interval.endTime) break;
      const cutStart = cut.startTime > cursor ? cut.startTime : cursor;
      const cutEnd = cut.endTime < interval.endTime ? cut.endTime : interval.endTime;
      if (cutStart > cursor) kept.push({ startTime: cursor, endTime: cutStart });
      if (cutEnd > cursor) cursor = cutEnd;
      if (cursor >= interval.endTime) break;
    }
    if (cursor < interval.endTime) kept.push({ startTime: cursor, endTime: interval.endTime });
  }
  return kept;
}

/**
 * Fermetures partielles à créer pour ramener les règles aux créneaux voulus
 * (changement d'horaires du jour : les trous entre deux plages restent intacts).
 */
export function diffOffs(rules: Rule[], slots: TimeSlot[]): TimeSlot[] {
  return subtract(rules, slots);
}

/** Créneaux effectifs d'un jour régulier : règles moins fermetures partielles. */
export function effectiveSlots(data: MonthData, key: string): TimeSlot[] {
  const partials = data.exceptions
    .filter((exception) => exception.date === key && exception.kind === "off" && !exception.fullDay)
    .map((exception) => ({
      startTime: exception.startTime ?? "00:00",
      endTime: exception.endTime ?? "00:00",
    }))
    .filter((slot) => slot.startTime < slot.endTime);
  return subtract(dayRules(data, key), partials);
}

/** Chaque créneau est-il couvert par les règles (un créneau à cheval sur un trou = non) ? */
export function slotsWithinRules(rules: Rule[], slots: TimeSlot[]): boolean {
  const ordered = [...rules].sort((first, second) => first.startTime.localeCompare(second.startTime));
  return slots.every((slot) => {
    let need = slot.startTime;
    for (const rule of ordered) {
      if (rule.endTime <= need) continue;
      if (rule.startTime > need) return false;
      if (rule.endTime > need) need = rule.endTime;
      if (need >= slot.endTime) return true;
    }
    return need >= slot.endTime;
  });
}

/** "09:00→12:00, 14:00→18:00" : plages habituelles d'un jour pour les messages. */
export function habitualRanges(data: MonthData, key: string): string {
  return dayRules(data, key)
    .map((rule) => `${rule.startTime}→${rule.endTime}`)
    .join(", ");
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
