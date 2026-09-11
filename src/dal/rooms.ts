import { getConnection } from "./connection";

import { and, eq, gte } from "drizzle-orm";

import { booking, room, roomMember } from "@/db/schema";

/** Repository salles (+ allowlists praticien). */

/** Salles d'un cabinet (pour la vue partagée / l'éditeur de dispos). */
export async function listRooms(officeId: string) {
  const conn = getConnection();
  return conn.select().from(room).where(eq(room.officeId, officeId));
}

export async function listRoomsWithMembers(officeId: string) {
  const conn = getConnection();
  const rooms = await conn.select().from(room).where(eq(room.officeId, officeId));
  const allMembers = await conn.select().from(roomMember);
  const byRoom = new Map<string, string[]>();
  for (const m of allMembers) {
    if (!rooms.some((r) => r.id === m.roomId)) continue;
    const list = byRoom.get(m.roomId) ?? [];
    list.push(m.practitionerId);
    byRoom.set(m.roomId, list);
  }
  return rooms.map((r) => ({ room: r, practitionerIds: byRoom.get(r.id) ?? [] }));
}

export async function createRoom(data: { id: string; officeId: string; name: string; color: string }) {
  const conn = getConnection();
  await conn.insert(room).values(data);
  return data.id;
}

export async function updateRoom(id: string,
  data: Partial<{ name: string; color: string }>) {
  const conn = getConnection();
  await conn.update(room).set(data).where(eq(room.id, id));
}

export async function replaceRoomMembers(roomId: string, practitionerIds: string[]) {
  const conn = getConnection();
  await conn.delete(roomMember).where(eq(roomMember.roomId, roomId));
  for (const practitionerId of practitionerIds) {
    await conn.insert(roomMember).values({ id: crypto.randomUUID(), roomId, practitionerId });
  }
}

export async function deleteRoom(id: string) {
  const conn = getConnection();
  await conn.delete(room).where(eq(room.id, id));
}

export async function countFutureBookingsByRoom(roomId: string,
  now: Date): Promise<number> {
  const conn = getConnection();
  const rows = await conn
    .select({ id: booking.id })
    .from(booking)
    .where(
      and(eq(booking.roomId, roomId), eq(booking.status, "confirmed"), gte(booking.startAt, now)),
    );
  return rows.length;
}
