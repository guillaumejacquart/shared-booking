/**
 * Utilitaires de dates pour les calendriers (toujours Europe/Paris,
 * cohérent avec le moteur de créneaux).
 */
export const TIMEZONE = "Europe/Paris";

/** "YYYY-MM-DD" vu à Paris. */
export function toKey(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** "YYYY-MM-DD" → Date à midi Paris (curseur stable, insensible DST). */
export function fromKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 10, 0, 0)); // 10h UTC = après-midi Paris toute l'année
}

export function addDays(at: Date, days: number): Date {
  return new Date(at.getTime() + days * 86_400_000);
}

/** "2026-09" → libellé "septembre 2026". */
export function monthLabel(year: number, monthIndex: number): string {
  const label = new Intl.DateTimeFormat("fr-FR", { timeZone: TIMEZONE, month: "long", year: "numeric" }).format(
    new Date(Date.UTC(year, monthIndex, 15, 10)),
  );
  return label;
}

export const WEEKDAY_SHORT = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

/** Les 42 cases (lundi-dimanche) couvrant le mois affiché. */
export function monthCells(year: number, monthIndex: number): { date: Date; key: string; inMonth: boolean }[] {
  const first = new Date(Date.UTC(year, monthIndex, 1, 10));
  // 0 = dimanche … 6 = samedi → décalage depuis lundi.
  const lead = (first.getUTCDay() + 6) % 7;
  const start = addDays(first, -lead);
  return Array.from({ length: 42 }, (unused, index) => {
    const date = addDays(start, index);
    return {
      date,
      key: toKey(date),
      inMonth: date.getUTCMonth() === monthIndex,
    };
  });
}
