import { dateStrInTz, weekdayInTz, zonedTimeToUtc } from "@/lib/timezone";

/**
 * Moteur de créneaux (SPEC.md §F7) — logique pure, sans accès DB.
 *
 * Entrées : règles hebdo (fenêtres du praticien, SANS salle) + exceptions +
 * occupation existante (praticien ET salles, buffers déjà inclus).
 * Sortie : créneaux réservables triés par heure de début, chacun avec la
 * salle attribuée (première salle autorisée libre, dans l'ordre fourni).
 *
 * Règles (grille coulissante) :
 * - Chaque fenêtre est balayée au pas `slotStepMin` depuis son début : tout
 *   départ `start = début + k * pas` est proposé.
 * - Un créneau est gardé si `start + duration <= fin de fenêtre`.
 * - Le buffer déborde librement hors fenêtre (temps de battement, pas de
 *   réservation) mais bloque praticien ET salle (inclus dans l'occupation).
 * - Un créneau hebdo est réservable si le praticien est libre ET au moins
 *   une salle autorisée est libre ; une ouverture exceptionnelle impose sa
 *   salle (réservable seulement si celle-ci est libre).
 * - Les chevauchements sont stricts : deux occupations qui se touchent
 *   (fin == début) ne se bloquent pas.
 */

export interface AvailabilityWindow {
  weekday: number; // 0 = dimanche … 6 = samedi
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  // Pas de salle : la disponibilité est celle du praticien.
}

export interface DayException {
  date: string; // "YYYY-MM-DD"
  kind: "off" | "extra";
  startTime?: string;
  endTime?: string;
  fullDay: boolean;
  roomId?: string; // requis si kind = 'extra'
}

/** Plage occupée, buffer inclus : [start, end). */
export interface Occupancy {
  start: Date;
  end: Date;
}

export interface SlotRequest {
  timezone: string;
  windows: AvailabilityWindow[];
  exceptions: DayException[];
  practitionerBusy: Occupancy[];
  /** Occupation par salle (buffers inclus), indexée par roomId. */
  roomBusy: Record<string, Occupancy[]>;
  /**
   * Salles attribuables au praticien, par ordre de préférence : la première
   * libre au créneau gagne. Les ouvertures exceptionnelles gardent leur
   * salle imposée (hors de cette liste si besoin).
   */
  allowedRoomIds: string[];
  /**
   * Restriction du type de séance demandé (vide/absent = toutes les salles
   * autorisées). S'applique aussi aux ouvertures exceptionnelles : un extra
   * dans une salle incompatible ne produit aucun créneau.
   */
  sessionRoomIds?: string[];
  sessionDurationMin: number;
  bufferAfterMin: number;
  /**
   * Pas de la grille coulissante, en minutes. Absent (tests historiques) =
   * ancien comportement (blocs `duration + buffer` accolés).
   */
  slotStepMin?: number;
  leadTimeMin: number;
  /** "Maintenant" (injecté pour les tests). */
  from: Date;
  /** Horizon de recherche en jours calendaires. */
  days: number;
}

export interface Slot {
  start: Date;
  end: Date;
  roomId: string;
}

interface Interval {
  start: number;
  end: number;
}

function overlaps(candidate: Interval, busy: Occupancy): boolean {
  return candidate.start < busy.end.getTime() && busy.start.getTime() < candidate.end;
}

/** Fenêtre ramenée au jour traité : salle imposée (extra) ou non (hebdo). */
interface DayWindow {
  startTime: string;
  endTime: string;
  roomId?: string;
}

function offInterval(exception: DayException, tz: string): Interval {
  if (exception.fullDay || !exception.startTime || !exception.endTime) {
    return { start: -Infinity, end: Infinity };
  }
  return {
    start: zonedTimeToUtc(exception.date, exception.startTime, tz).getTime(),
    end: zonedTimeToUtc(exception.date, exception.endTime, tz).getTime(),
  };
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

/** Fermetures par date ; les extras imposent leur salle, les règles hebdo non. */
function indexExceptions(req: SlotRequest) {
  const offByDate = new Map<string, Interval[]>();
  const extraByDate = new Map<string, DayWindow[]>();
  for (const exception of req.exceptions) {
    if (exception.kind === "off") {
      pushTo(offByDate, exception.date, offInterval(exception, req.timezone));
    } else if (exception.startTime && exception.endTime) {
      pushTo(extraByDate, exception.date, {
        startTime: exception.startTime,
        endTime: exception.endTime,
        roomId: exception.roomId,
      });
    }
  }
  return { offByDate, extraByDate };
}

/** Salle imposée (extra) ou salles autorisées (hebdo), filtrées par le type de séance. */
function roomCandidates(window: DayWindow, req: SlotRequest): string[] {
  const base = window.roomId ? [window.roomId] : req.allowedRoomIds;
  const sessionRoomIds = req.sessionRoomIds ?? [];
  return sessionRoomIds.length > 0 ? base.filter((id) => sessionRoomIds.includes(id)) : base;
}

function slotsInWindow(req: SlotRequest, dateStr: string, window: DayWindow, offs: Interval[]): Slot[] {
  const tz = req.timezone;
  const durationMs = req.sessionDurationMin * 60_000;
  // Grille coulissante au pas choisi, repli historique sur duration + buffer.
  const stepMin = req.slotStepMin && req.slotStepMin > 0
    ? req.slotStepMin
    : req.sessionDurationMin + req.bufferAfterMin;
  const stepMs = stepMin * 60_000;
  // L'empreinte bloquante reste durée + buffer (le pas ne change que la densité).
  const blockedMs = (req.sessionDurationMin + req.bufferAfterMin) * 60_000;
  const earliest = req.from.getTime() + req.leadTimeMin * 60_000;
  const windowStart = zonedTimeToUtc(dateStr, window.startTime, tz).getTime();
  const windowEnd = zonedTimeToUtc(dateStr, window.endTime, tz).getTime();
  const candidates = roomCandidates(window, req);
  const slots: Slot[] = [];
  for (let start = windowStart; start + durationMs <= windowEnd; start += stepMs) {
    if (start < earliest) continue;
    const candidate: Interval = { start, end: start + blockedMs };
    if (offs.some((off) => candidate.start < off.end && off.start < candidate.end)) continue;
    if (req.practitionerBusy.some((busy) => overlaps(candidate, busy))) continue;
    const roomId = candidates.find(
      (id) => !(req.roomBusy[id] ?? []).some((busy) => overlaps(candidate, busy)),
    );
    if (roomId) slots.push({ start: new Date(start), end: new Date(start + durationMs), roomId });
  }
  return slots;
}

export function generateSlots(req: SlotRequest): Slot[] {
  const tz = req.timezone;
  const { offByDate, extraByDate } = indexExceptions(req);
  const byWeekday = new Map<number, DayWindow[]>();
  for (const window of req.windows) {
    pushTo(byWeekday, window.weekday, { startTime: window.startTime, endTime: window.endTime });
  }

  const slots: Slot[] = [];
  // Curseur à midi (heure murale) : +24h reste sur le lendemain même les
  // jours de changement d'heure (23h/25h).
  let cursor = zonedTimeToUtc(dateStrInTz(req.from, tz), "12:00", tz);
  for (let day = 0; day < req.days; day++) {
    const dateStr = dateStrInTz(cursor, tz);
    const dayWindows = [...(byWeekday.get(weekdayInTz(cursor, tz)) ?? []), ...(extraByDate.get(dateStr) ?? [])];
    const offs = offByDate.get(dateStr) ?? [];
    for (const window of dayWindows) slots.push(...slotsInWindow(req, dateStr, window, offs));
    cursor = new Date(cursor.getTime() + 24 * 3_600_000);
  }

  slots.sort((left, right) => left.start.getTime() - right.start.getTime());
  return slots;
}
