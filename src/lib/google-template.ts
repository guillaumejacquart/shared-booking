/**
 * Lien "Ajouter à Google Agenda" (sans authentification).
 * Template URL officiel :
 * https://calendar.google.com/calendar/render?action=TEMPLATE&text=...&dates=START/END
 * Dates au format `YYYYMMDDTHHMMSSZ` (UTC).
 */

function gcalDate(at: Date): string {
  return at.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

export function googleCalendarTemplateUrl(args: {
  title: string;
  start: Date;
  end: Date;
  description?: string;
  location?: string;
}): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: args.title,
    dates: `${gcalDate(args.start)}/${gcalDate(args.end)}`,
  });
  if (args.description) params.set("details", args.description);
  if (args.location) params.set("location", args.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
