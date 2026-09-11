import { NextRequest, NextResponse } from "next/server";

import { db } from "@/db/client";
import * as store from "@/dal/store";
import { dateStrInTz } from "@/lib/timezone";
import { toResponse } from "@/app/api/errors";
import { getAuthUser, unauthorized } from "@/app/api/_auth";

/**
 * Données mensuelles pour le calendrier de disponibilités du praticien
 * connecté (règles + exceptions + ses réservations + salles).
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 42), 1), 62);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }
  try {
    const prac = await store.getPractitionerByUserId(db, user.id);
    if (!prac) return NextResponse.json({ error: "Praticien introuvable" }, { status: 404 });
    const to = dateStrInTz(new Date(new Date(`${from}T12:00:00Z`).getTime() + days * 86_400_000), "Europe/Paris");
    const [rules, exceptions, bookings, rooms] = await Promise.all([
      store.listRules(db, prac.id),
      store.listExceptions(db, prac.id, from, to),
      store.listBookingsForPractitioner(
        db,
        prac.id,
        new Date(`${from}T00:00:00Z`),
        new Date(new Date(`${from}T00:00:00Z`).getTime() + (days + 1) * 86_400_000),
      ),
      store.listRooms(db, prac.officeId),
    ]);
    return NextResponse.json({
      rules: rules.map((r) => ({ weekday: r.weekday, startTime: r.startTime, endTime: r.endTime, roomId: r.roomId })),
      exceptions: exceptions.map((x) => ({
        id: x.id,
        date: x.date,
        kind: x.kind,
        startTime: x.startTime,
        endTime: x.endTime,
        fullDay: x.fullDay,
        roomId: x.roomId,
        reason: x.reason,
      })),
      bookings: bookings
        .filter((b) => b.status !== "cancelled")
        .map((b) => ({ id: b.id, startAt: b.startAt.toISOString(), endAt: b.endAt.toISOString(), status: b.status })),
      rooms: rooms.map((r) => ({ id: r.id, name: r.name, color: r.color })),
    });
  } catch (e) {
    return toResponse(e);
  }
}
