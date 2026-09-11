import { NextRequest, NextResponse } from "next/server";

import { getAgendaEvents } from "@/lib/services/calendar";
import { toResponse } from "@/app/api/errors";
import { getAuthUser, unauthorized } from "@/app/api/_auth";

/**
 * Événements FullCalendar de l'agenda du praticien connecté.
 * `?start=ISO&end=ISO` (fenêtre visible du calendrier).
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const url = new URL(req.url);
  const start = new Date(url.searchParams.get("start") ?? "");
  const end = new Date(url.searchParams.get("end") ?? "");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }
  try {
    return NextResponse.json(await getAgendaEvents({}, { userId: user.id, start, end }));
  } catch (e) {
    return toResponse(e);
  }
}
