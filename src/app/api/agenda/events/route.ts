import { NextRequest, NextResponse } from "next/server";

import { db } from "@/db/client";
import * as store from "@/dal/store";
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
    const prac = await store.getPractitionerByUserId(db, user.id);
    if (!prac) return NextResponse.json({ error: "Praticien introuvable" }, { status: 404 });
    const bookings = await store.listBookingsForPractitioner(db, prac.id, start, end);
    return NextResponse.json({
      events: bookings.map((b) => ({
        id: b.id,
        title: `${b.sessionNameSnapshot} — ${b.patientFirstName} ${b.patientLastName}`,
        start: b.startAt.toISOString(),
        end: b.endAt.toISOString(),
        backgroundColor:
          b.status === "confirmed"
            ? "#18181b"
            : b.status === "pending"
              ? "#b45309"
              : b.status === "completed"
                ? "#a1a1aa"
                : "#e4e4e7",
        borderColor:
          b.status === "confirmed"
            ? "#18181b"
            : b.status === "pending"
              ? "#b45309"
              : b.status === "completed"
                ? "#a1a1aa"
                : "#e4e4e7",
        textColor: b.status === "cancelled" ? "#52525b" : "#fafafa",
        extendedProps: {
          status: b.status,
          paymentStatus: b.paymentStatus,
          validationRequired: b.validationRequired,
          sessionName: b.sessionNameSnapshot,
          patientName: `${b.patientFirstName} ${b.patientLastName}`,
          patientEmail: b.patientEmail,
          patientPhone: b.patientPhone,
          notes: b.notes,
          cancelToken: b.cancelToken,
        },
      })),
    });
  } catch (e) {
    return toResponse(e);
  }
}
