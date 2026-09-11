/**
 * Helpers fuseau horaire sans dépendance (le MVP est fixé sur Europe/Paris,
 * mais ces fonctions prennent un `timeZone` explicite pour préparer l'i18n).
 */

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function dtf(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

interface TzParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
  weekday: string;
}

export function partsInTz(date: Date, timeZone: string): TzParts {
  const parts: Record<string, string> = {};
  for (const p of dtf(timeZone).formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return parts as unknown as TzParts;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** 0 = dimanche … 6 = samedi, vu dans le fuseau donné. */
export function weekdayInTz(date: Date, timeZone: string): number {
  return WEEKDAYS.indexOf(partsInTz(date, timeZone).weekday);
}

/** "YYYY-MM-DD" vu dans le fuseau donné. */
export function dateStrInTz(date: Date, timeZone: string): string {
  const p = partsInTz(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Décalage (ms) tel que heureMurale = UTC + offset, à l'instant donné. */
export function tzOffsetMs(timeZone: string, instant: Date): number {
  const p = partsInTz(instant, timeZone);
  const asUtc = Date.UTC(
    +p.year,
    +p.month - 1,
    +p.day,
    +p.hour % 24,
    +p.minute,
    +p.second,
  );
  return asUtc - instant.getTime();
}

/**
 * "2026-09-15" + "09:00" vus dans `timeZone` → instant UTC.
 * Double passe pour rester juste sur les jours de changement d'heure.
 */
export function zonedTimeToUtc(
  dateStr: string,
  timeStr: string,
  timeZone: string,
): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const off1 = tzOffsetMs(timeZone, guess);
  const off2 = tzOffsetMs(timeZone, new Date(guess.getTime() - off1));
  return new Date(guess.getTime() - (off2 === off1 ? off1 : off2));
}
