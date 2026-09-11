import { NextRequest, NextResponse } from "next/server";

import { db } from "@/db/client";
import * as store from "@/dal/store";
import { practitionerColor } from "@/lib/calendar-colors";
import { toResponse } from "@/app/api/errors";
import { getAuthUser, unauthorized } from "@/app/api/_auth";

/**
 * Événements FullCalendar du calendrier partagé.
 * Noms des patients masqués sauf pour soi et le owner (SPEC.md §F10).
 * Couleur = salle (même sémantique que les pastilles précédentes).
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
    const membership = await store.getMembership(db, prac.officeId, user.id);
    if (!membership) return NextResponse.json({ error: "Action non autorisée" }, { status: 403 });
    const isOwner = membership.role === "owner";

    const [pracs, rooms, bookings] = await Promise.all([
      store.listPractitionersByOffice(db, prac.officeId),
      store.listRooms(db, prac.officeId),
      store.listOfficeBookings(db, prac.officeId, start, end),
    ]);
    const pracById = new Map(pracs.map((p) => [p.id, p]));
    const roomById = new Map(rooms.map((r) => [r.id, r]));
    const sortedIds = [...pracs].map((p) => p.id).sort();
    const colorOf = (practitionerId: string) => practitionerColor(sortedIds, practitionerId);

    return NextResponse.json({
      rooms: rooms.map((r) => ({ id: r.id, name: r.name, color: r.color })),
      practitioners: pracs.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        color: colorOf(p.id),
      })),
      events: bookings.map((b) => {
        const p = pracById.get(b.practitionerId);
        const room = roomById.get(b.roomId);
        const mine = b.practitionerId === prac.id;
        const visible = mine || isOwner;
        const color = colorOf(b.practitionerId);
        return {
          id: b.id,
          // Le praticien est identifié par sa couleur + ses initiales
          // (rendu personnalisé) ; le titre reste court.
          title: visible
            ? `${b.sessionNameSnapshot} — ${b.patientFirstName} ${b.patientLastName}`
            : "Réservé",
          start: b.startAt.toISOString(),
          end: b.endAt.toISOString(),
          backgroundColor: color,
          borderColor: color,
          textColor: "#fafafa",
          extendedProps: {
            status: b.status,
            validationRequired: b.validationRequired,
            practitionerName: p?.displayName ?? "",
            practitionerColor: color,
            roomName: room?.name ?? "",
            roomColor: room?.color ?? null,
            sessionName: b.sessionNameSnapshot,
            mine,
            patientName: visible ? `${b.patientFirstName} ${b.patientLastName}` : null,
            patientEmail: visible ? b.patientEmail : null,
            patientPhone: visible ? (b.patientPhone ?? null) : null,
            cancelToken: mine && b.status === "confirmed" ? b.cancelToken : null,
          },
        };
      }),
    });
  } catch (e) {
    return toResponse(e);
  }
}
