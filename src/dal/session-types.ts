import { getConnection } from "./connection";

import { and, asc, eq, gte, inArray } from "drizzle-orm";

import {
  booking,
  sessionType,
  sessionTypeRoom,
  sessionTypeVariant,
} from "@/db/schema";

/** Repository types de séances (+ leurs déclinaisons durée/prix). */

export async function listSessionTypes(practitionerId: string) {
  const conn = getConnection();
  return conn
    .select()
    .from(sessionType)
    .where(eq(sessionType.practitionerId, practitionerId));
}

/** Déclinaisons d'une séance, triées (ordre d'affichage puis durée). */
export async function listVariants(sessionTypeId: string) {
  const conn = getConnection();
  return conn
    .select()
    .from(sessionTypeVariant)
    .where(eq(sessionTypeVariant.sessionTypeId, sessionTypeId))
    .orderBy(asc(sessionTypeVariant.sortOrder), asc(sessionTypeVariant.durationMin));
}

/** Déclinaisons de toutes les séances d'un praticien. */
export async function listVariantsByPractitioner(
  practitionerId: string,
): Promise<{ sessionTypeId: string; variant: typeof sessionTypeVariant.$inferSelect }[]> {
  const conn = getConnection();
  const types = await conn
    .select({ id: sessionType.id })
    .from(sessionType)
    .where(eq(sessionType.practitionerId, practitionerId));
  if (types.length === 0) return [];
  const ids = new Set(types.map((sessionType) => sessionType.id));
  const rows = await conn
    .select()
    .from(sessionTypeVariant)
    .orderBy(asc(sessionTypeVariant.sortOrder), asc(sessionTypeVariant.durationMin));
  return rows
    .filter((row) => ids.has(row.sessionTypeId))
    .map((variant) => ({ sessionTypeId: variant.sessionTypeId, variant }));
}

export async function createSessionType(data: {
  id: string;
  practitionerId: string;
  name: string;
  description: string | null;
  requiresPayment?: boolean;
  requiresValidation?: boolean;
}) {
  const conn = getConnection();
  await conn.insert(sessionType).values({
    ...data,
    active: true,
    requiresPayment: data.requiresPayment ?? false,
    requiresValidation: data.requiresValidation ?? false,
  });
  return data.id;
}

export async function updateSessionType(
  id: string,
  data: Partial<{
    name: string;
    description: string | null;
    active: boolean;
    requiresPayment: boolean;
    requiresValidation: boolean;
  }>,
) {
  const conn = getConnection();
  await conn.update(sessionType).set(data).where(eq(sessionType.id, id));
}

export async function deleteSessionType(id: string) {
  const conn = getConnection();
  await conn.delete(sessionType).where(eq(sessionType.id, id));
}

export async function createVariant(data: {
  id: string;
  sessionTypeId: string;
  durationMin: number;
  bufferAfterMin: number;
  priceDisplay: string | null;
  priceCents: number | null;
  sortOrder?: number;
}) {
  const conn = getConnection();
  await conn.insert(sessionTypeVariant).values({ sortOrder: 0, ...data });
  return data.id;
}

export async function updateVariant(
  id: string,
  data: Partial<{
    durationMin: number;
    bufferAfterMin: number;
    priceDisplay: string | null;
    priceCents: number | null;
    sortOrder: number;
  }>,
) {
  const conn = getConnection();
  await conn.update(sessionTypeVariant).set(data).where(eq(sessionTypeVariant.id, id));
}

export async function deleteVariant(id: string) {
  const conn = getConnection();
  await conn.delete(sessionTypeVariant).where(eq(sessionTypeVariant.id, id));
}

/** Salles compatibles d'un type de séance (vide = toutes). */
export async function listCompatibleRoomIds(sessionTypeId: string): Promise<string[]> {
  const conn = getConnection();
  const rows = await conn
    .select({ roomId: sessionTypeRoom.roomId })
    .from(sessionTypeRoom)
    .where(eq(sessionTypeRoom.sessionTypeId, sessionTypeId));
  return rows.map((row) => row.roomId);
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
  const ids = new Set(types.map((sessionType) => sessionType.id));
  return rows.filter((row) => ids.has(row.sessionTypeId));
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

export async function countFutureBookingsBySessionType(
  sessionTypeId: string,
  now: Date,
): Promise<number> {
  const conn = getConnection();
  // Bloque la suppression tant qu'une réservation non effectuée subsiste :
  // confirmée à venir ou en attente de paiement (créneau tenu 30 min).
  // Annulées / effectuées : la suppression met la référence à NULL (SET NULL).
  const rows = await conn
    .select({ id: booking.id })
    .from(booking)
    .where(
      and(
        eq(booking.sessionTypeId, sessionTypeId),
        inArray(booking.status, ["confirmed", "pending"]),
        gte(booking.startAt, now),
      ),
    );
  return rows.length;
}

export async function countFutureBookingsByVariant(variantId: string, now: Date): Promise<number> {
  const conn = getConnection();
  const rows = await conn
    .select({ id: booking.id })
    .from(booking)
    .where(
      and(
        eq(booking.sessionVariantId, variantId),
        inArray(booking.status, ["confirmed", "pending"]),
        gte(booking.startAt, now),
      ),
    );
  return rows.length;
}
