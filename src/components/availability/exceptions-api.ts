/** Appels HTTP des exceptions de disponibilité (fermetures / ouvertures). */

export async function deleteException(practitionerId: string, id: string): Promise<void> {
  await fetch(`/api/exceptions/${id}?practitionerId=${practitionerId}`, { method: "DELETE" });
}

export async function closeDay(practitionerId: string, date: string): Promise<boolean> {
  const res = await fetch("/api/exceptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ practitionerId, date, kind: "off", fullDay: true }),
  });
  return res.ok;
}

export interface Opening {
  startTime: string;
  endTime: string;
  roomId: string;
}

function toMinutesOrNull(hhmm: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function toTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, minutes));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

/** Nouveau créneau qui enchaîne `last` : début = fin précédente, même durée et même salle. */
export function slotAfter(last: Opening): Opening {
  const startMin = toMinutesOrNull(last.endTime);
  const prevStartMin = toMinutesOrNull(last.startTime);
  if (startMin === null || prevStartMin === null || startMin <= prevStartMin) {
    return { startTime: "09:00", endTime: "12:00", roomId: last.roomId };
  }
  const nextEnd = startMin + (startMin - prevStartMin);
  if (nextEnd > 23 * 60 + 59) {
    return { startTime: "09:00", endTime: "12:00", roomId: last.roomId };
  }
  return { startTime: last.endTime, endTime: toTime(nextEnd), roomId: last.roomId };
}

export async function openDay(practitionerId: string, date: string, opening: Opening): Promise<boolean> {
  const res = await fetch("/api/exceptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ practitionerId, date, kind: "extra", fullDay: false, ...opening }),
  });
  return res.ok;
}

/** Fermeture partielle (ex. matinée) : rogne les horaires habituels du jour. */
export async function createPartialOff(
  practitionerId: string,
  date: string,
  startTime: string,
  endTime: string,
): Promise<boolean> {
  const res = await fetch("/api/exceptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ practitionerId, date, kind: "off", fullDay: false, startTime, endTime }),
  });
  return res.ok;
}
