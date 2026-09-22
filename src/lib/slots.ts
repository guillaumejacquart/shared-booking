import { dateStrInTz, weekdayInTz, zonedTimeToUtc } from "./timezone";

/**
 * Moteur de créneaux (SPEC.md §F7) — logique pure, sans accès DB.
 *
 * Entrées : règles hebdo (fenêtres du praticien, SANS salle) + exceptions +
 * occupation existante (praticien ET salles, buffers déjà inclus).
 * Sortie : créneaux réservables triés par heure de début, chacun avec la
 * salle attribuée (première salle autorisée libre, dans l'ordre fourni).
 *
 * Règles :
 * - Chaque fenêtre de dispo est découpée en blocs `duration + buffer` accolés.
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

export function generateSlots(req: SlotRequest): Slot[] {
  const tz = req.timezone;
  const durationMs = req.sessionDurationMin * 60_000;
  const stepMs = (req.sessionDurationMin + req.bufferAfterMin) * 60_000;
  const earliest = req.from.getTime() + req.leadTimeMin * 60_000;

  const offByDate = new Map<string, Interval[]>();
  /** Fenêtre du jour : les extras imposent leur salle, les règles hebdo non. */
  const extraByDate = new Map<string, { startTime: string; endTime: string; roomId?: string }[]>();
  for (const e of req.exceptions) {
    if (e.kind === "off") {
      const list = offByDate.get(e.date) ?? [];
      list.push(
        e.fullDay || !e.startTime || !e.endTime
          ? { start: -Infinity, end: Infinity }
          : {
              start: zonedTimeToUtc(e.date, e.startTime, tz).getTime(),
              end: zonedTimeToUtc(e.date, e.endTime, tz).getTime(),
            },
      );
      offByDate.set(e.date, list);
    } else if (e.startTime && e.endTime) {
      const list = extraByDate.get(e.date) ?? [];
      // Le jour de semaine sera recalculé au traitement du jour ; on stocke
      // la fenêtre brute et on l'applique directement à cette date.
      list.push({ startTime: e.startTime, endTime: e.endTime, roomId: e.roomId });
      extraByDate.set(e.date, list);
    }
  }

  /** Fenêtre ramenée au jour traité : salle imposée (extra) ou non (hebdo). */
  interface DayWindow {
    startTime: string;
    endTime: string;
    roomId?: string;
  }

  const byWeekday = new Map<number, DayWindow[]>();
  for (const w of req.windows) {
    const list = byWeekday.get(w.weekday) ?? [];
    list.push({ startTime: w.startTime, endTime: w.endTime });
    byWeekday.set(w.weekday, list);
  }

  const slots: Slot[] = [];
  // Curseur à midi (heure murale) : +24h reste sur le lendemain même les
  // jours de changement d'heure (23h/25h).
  let cursor = zonedTimeToUtc(dateStrInTz(req.from, tz), "12:00", tz);

  for (let day = 0; day < req.days; day++) {
    const dateStr = dateStrInTz(cursor, tz);
    const weekday = weekdayInTz(cursor, tz);
    const dayWindows = [...(byWeekday.get(weekday) ?? []), ...(extraByDate.get(dateStr) ?? [])];
    const offs = offByDate.get(dateStr) ?? [];

    for (const w of dayWindows) {
      const ws = zonedTimeToUtc(dateStr, w.startTime, tz).getTime();
      const we = zonedTimeToUtc(dateStr, w.endTime, tz).getTime();
      if (!(ws < we)) continue;
      // Salle imposée (extra) ou salles autorisées (hebdo), intersectées
      // avec la restriction éventuelle du type de séance.
      const base = w.roomId ? [w.roomId] : req.allowedRoomIds;
      const candidates =
        req.sessionRoomIds && req.sessionRoomIds.length > 0
          ? base.filter((id) => req.sessionRoomIds!.includes(id))
          : base;

      for (let t = ws; t + durationMs <= we; t += stepMs) {
        if (t < earliest) continue;
        const candidate: Interval = { start: t, end: t + stepMs };
        if (offs.some((o) => candidate.start < o.end && o.start < candidate.end)) continue;
        if (req.practitionerBusy.some((b) => overlaps(candidate, b))) continue;
        const roomId = candidates.find(
          (id) => !(req.roomBusy[id] ?? []).some((b) => overlaps(candidate, b)),
        );
        if (!roomId) continue;
        slots.push({ start: new Date(t), end: new Date(t + durationMs), roomId });
      }
    }

    cursor = new Date(cursor.getTime() + 24 * 3_600_000);
  }

  slots.sort((a, b) => a.start.getTime() - b.start.getTime());
  return slots;
}
