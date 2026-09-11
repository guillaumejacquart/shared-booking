/**
 * Formateurs de dates partagés (toujours Europe/Paris).
 * Centralisés ici pour une présentation identique partout.
 */
export const TIMEZONE = "Europe/Paris";

export const timeFmt = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
});

export const dayFmt = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TIMEZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});

export const fullFmt = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TIMEZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
});
