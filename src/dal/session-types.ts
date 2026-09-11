import { and, eq, gte } from "drizzle-orm";

import { booking, sessionType } from "@/db/schema";
import type { DbOrTx } from "./types";

/** Repository types de séances. */

export async function listSessionTypes(db: DbOrTx, practitionerId: string) {
  return db
    .select()
    .from(sessionType)
    .where(eq(sessionType.practitionerId, practitionerId));
}

export async function createSessionType(
  db: DbOrTx,
  data: {
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
) {
  await db.insert(sessionType).values({
    ...data,
    active: true,
    requiresPayment: data.requiresPayment ?? false,
    priceCents: data.priceCents ?? null,
    requiresValidation: data.requiresValidation ?? false,
  });
  return data.id;
}

export async function updateSessionType(
  db: DbOrTx,
  id: string,
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
) {
  await db.update(sessionType).set(data).where(eq(sessionType.id, id));
}

export async function deleteSessionType(db: DbOrTx, id: string) {
  await db.delete(sessionType).where(eq(sessionType.id, id));
}

export async function countFutureBookingsBySessionType(
  db: DbOrTx,
  sessionTypeId: string,
  now: Date,
): Promise<number> {
  const rows = await db
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
