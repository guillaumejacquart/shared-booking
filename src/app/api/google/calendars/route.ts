import { NextResponse } from "next/server";

import { withAuth } from "@/app/api/_auth";
import { services } from "@/lib/container";

/** Agendas du compte Google connecté (sélecteur de destination du push). */
export const GET = withAuth(async (user) => {
  return NextResponse.json({ calendars: await services.google.listGoogleCalendars(user.id) });
});
