import type { GoogleCalendarEvent } from "./google-calendar";

/**
 * Transformations pures des événements Google en occupations bloquantes
 * (inbound). Aucune règle d'accès ici : voir `services/google-busy.ts`.
 *
 * - `transparent` (marqué « disponible » dans Google) ne bloque jamais.
 * - Les miroirs créés par l'app sont ignorés : ils correspondent à des
 *   réservations déjà connues localement (un miroir orphelin après un échec
 *   de suppression ne doit pas bloquer le créneau à vie).
 * - Les journées entières sont exclues par défaut (anniversaires, rappels) ;
 *   `includeAllDay` les bloque (congés, absences).
 */

export interface BusyInterval {
  start: Date;
  end: Date;
}

export function busyIntervals(
  events: GoogleCalendarEvent[],
  options: { includeAllDay: boolean },
): BusyInterval[] {
  const kept = events
    .filter((event) => !event.transparent && !event.isMirror)
    .filter((event) => options.includeAllDay || !event.allDay)
    .map((event) => ({ start: event.startAt, end: event.endAt }))
    .sort((left, right) => left.start.getTime() - right.start.getTime());
  return mergeIntervals(kept);
}

/** Union d'intervalles : réduit les comparaisons du moteur de créneaux. */
export function mergeIntervals(intervals: BusyInterval[]): BusyInterval[] {
  const merged: BusyInterval[] = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && interval.start.getTime() <= last.end.getTime()) {
      if (interval.end > last.end) last.end = interval.end;
      continue;
    }
    merged.push({ start: new Date(interval.start), end: new Date(interval.end) });
  }
  return merged;
}
