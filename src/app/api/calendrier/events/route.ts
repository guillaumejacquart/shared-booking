import { type NextRequest, NextResponse } from "next/server";

import { services } from "@/lib/container";
import { withAuth } from "@/app/api/_auth";

/** Événements FullCalendar du calendrier partagé (`?start=ISO&end=ISO`). */
export const GET = withAuth(async (user, req: NextRequest) => {
  const url = new URL(req.url);
  const start = new Date(url.searchParams.get("start") ?? "");
  const end = new Date(url.searchParams.get("end") ?? "");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }
  return NextResponse.json(await services.calendar.shared({ userId: user.id, start, end }));
});
