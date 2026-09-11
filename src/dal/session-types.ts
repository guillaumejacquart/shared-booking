import { db } from "@/db/client";

import { and, eq, gte } from "drizzle-orm";

import { booking, sessionType } from "@/db/schema";
import type { DbOrTx } from "./types";

/** Repository types de séances. */

export async function listSessionTypes(practitionerId: string,
  tx?: DbOrTx) {
  const conn = tx ?? db;
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
  },
  tx?: DbOrTx) {
  const conn = tx ?? db;
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
  }>,
  tx?: DbOrTx) {
  const conn = tx ?? db;
  await conn.update(sessionType).set(data).where(eq(sessionType.id, id));
}

export async function deleteSessionType(id: string,
  tx?: DbOrTx) {
  const conn = tx ?? db;
  await conn.delete(sessionType).where(eq(sessionType.id, id));
}

export async function countFutureBookingsBySessionType(sessionTypeId: string,
  now: Date,
  tx?: DbOrTx): Promise<number> {
  const conn = tx ?? db;
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
