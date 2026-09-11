import { getConnection } from "./connection";

import { and, eq, gte } from "drizzle-orm";

import { booking, sessionType } from "@/db/schema";

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
