import { getConnection } from "./connection";

import { and, eq, gte } from "drizzle-orm";

import { booking, sessionType, sessionTypeRoom } from "@/db/schema";

/** Repository types de séances. */

export async function listSessionTypes(practitionerId: string) {
  const conn = getConnection();
  return conn
    .select()
    .from(sessionType)
    .where(eq(sessionType.practitionerId, practitionerId));
}

export async function createSessionType(data: {
    id: string;
    practitionerId: string;
    name: string;
    description: string | null;
    durationMin: number;
    bufferAfterMin: number;
    priceDisplay: string | null;
    requiresPayment?: boolean;
    priceCents?: number | null;
    requiresValidation?: boolean;
  }) {
  const conn = getConnection();
  await conn.insert(sessionType).values({
    ...data,
    active: true,
    requiresPayment: data.requiresPayment ?? false,
    priceCents: data.priceCents ?? null,
    requiresValidation: data.requiresValidation ?? false,
  });
  return data.id;
}

export async function updateSessionType(id: string,
  data: Partial<{
    name: string;
    description: string | null;
    durationMin: number;
    bufferAfterMin: number;
    priceDisplay: string | null;
    active: boolean;
    requiresPayment: boolean;
    priceCents: number | null;
    requiresValidation: boolean;
  }>) {
  const conn = getConnection();
  await conn.update(sessionType).set(data).where(eq(sessionType.id, id));
}

export async function deleteSessionType(id: string) {
  const conn = getConnection();
  await conn.delete(sessionType).where(eq(sessionType.id, id));
}

/** Salles compatibles d'un type de séance (vide = toutes). */
export async function listCompatibleRoomIds(sessionTypeId: string): Promise<string[]> {
  const conn = getConnection();
  const rows = await conn
    .select({ roomId: sessionTypeRoom.roomId })
    .from(sessionTypeRoom)
    .where(eq(sessionTypeRoom.sessionTypeId, sessionTypeId));
  return rows.map((r) => r.roomId);
}

/** Salles compatibles de tous les types d'un praticien. */
export async function listCompatibleRoomsByPractitioner(
  practitionerId: string,
): Promise<{ sessionTypeId: string; roomId: string }[]> {
  const conn = getConnection();
  const types = await conn
    .select({ id: sessionType.id })
    .from(sessionType)
    .where(eq(sessionType.practitionerId, practitionerId));
  if (types.length === 0) return [];
  const rows = await conn
    .select({ sessionTypeId: sessionTypeRoom.sessionTypeId, roomId: sessionTypeRoom.roomId })
    .from(sessionTypeRoom);
  const ids = new Set(types.map((t) => t.id));
  return rows.filter((r) => ids.has(r.sessionTypeId));
}

/** Remplace les salles compatibles d'un type de séance (vide = toutes). */
export async function replaceCompatibleRooms(sessionTypeId: string, roomIds: string[]) {
  const conn = getConnection();
  await conn.delete(sessionTypeRoom).where(eq(sessionTypeRoom.sessionTypeId, sessionTypeId));
  for (const roomId of roomIds) {
    await conn.insert(sessionTypeRoom).values({ id: crypto.randomUUID(), sessionTypeId, roomId });
  }
}

export async function countSessionTypesByRoom(roomId: string): Promise<number> {
  const conn = getConnection();
  const rows = await conn
    .select({ id: sessionTypeRoom.id })
    .from(sessionTypeRoom)
    .where(eq(sessionTypeRoom.roomId, roomId));
  return rows.length;
}

export async function countFutureBookingsBySessionType(sessionTypeId: string,
  now: Date): Promise<number> {
  const conn = getConnection();
  const rows = await conn
    .select({ id: booking.id })
    .from(booking)
    .where(
      and(
        eq(booking.sessionTypeId, sessionTypeId),
        eq(booking.status, "confirmed"),
        gte(booking.startAt, now),
      ),
    );
  return rows.length;
}
