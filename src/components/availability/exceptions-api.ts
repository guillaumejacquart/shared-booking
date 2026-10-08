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
