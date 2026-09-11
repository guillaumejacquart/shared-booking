import { and, eq, gte } from "drizzle-orm";

import { booking, room, roomMember } from "@/db/schema";
import type { DbOrTx } from "./types";

/** Repository salles (+ allowlists praticien). */

/** Salles d'un cabinet (pour la vue partagée / l'éditeur de dispos). */
export async function listRooms(db: DbOrTx, officeId: string) {
  return db.select().from(room).where(eq(room.officeId, officeId));
}

export async function listRoomsWithMembers(db: DbOrTx, officeId: string) {
  const rooms = await db.select().from(room).where(eq(room.officeId, officeId));
  const allMembers = await db.select().from(roomMember);
  const byRoom = new Map<string, string[]>();
  for (const m of allMembers) {
    if (!rooms.some((r) => r.id === m.roomId)) continue;
    const list = byRoom.get(m.roomId) ?? [];
    list.push(m.practitionerId);
    byRoom.set(m.roomId, list);
  }
  return rooms.map((r) => ({ room: r, practitionerIds: byRoom.get(r.id) ?? [] }));
}

export async function createRoom(
  db: DbOrTx,
  data: { id: string; officeId: string; name: string; color: string },
) {
  await db.insert(room).values(data);
  return data.id;
}

export async function updateRoom(
  db: DbOrTx,
  id: string,
  data: Partial<{ name: string; color: string }>,
) {
  await db.update(room).set(data).where(eq(room.id, id));
}

export async function replaceRoomMembers(db: DbOrTx, roomId: string, practitionerIds: string[]) {
  await db.delete(roomMember).where(eq(roomMember.roomId, roomId));
  for (const practitionerId of practitionerIds) {
    await db.insert(roomMember).values({ id: crypto.randomUUID(), roomId, practitionerId });
  }
}

export async function deleteRoom(db: DbOrTx, id: string) {
  await db.delete(room).where(eq(room.id, id));
}

export async function countFutureBookingsByRoom(
  db: DbOrTx,
  roomId: string,
  now: Date,
): Promise<number> {
  const rows = await db
    .select({ id: booking.id })
    .from(booking)
    .where(
      and(eq(booking.roomId, roomId), eq(booking.status, "confirmed"), gte(booking.startAt, now)),
    );
  return rows.length;
}
