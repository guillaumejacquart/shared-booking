import { and, eq, gte, lte } from "drizzle-orm";

import { availabilityRule, exception } from "@/db/schema";
import type { DbOrTx } from "./types";

/** Repository disponibilités : règles hebdo + exceptions. */

export async function listRules(db: DbOrTx, practitionerId: string) {
  return db
    .select()
    .from(availabilityRule)
    .where(eq(availabilityRule.practitionerId, practitionerId));
}

export async function countRulesByRoom(db: DbOrTx, roomId: string): Promise<number> {
  const rows = await db
    .select({ id: availabilityRule.id })
    .from(availabilityRule)
    .where(eq(availabilityRule.roomId, roomId));
  return rows.length;
}

export async function listExceptions(
  db: DbOrTx,
  practitionerId: string,
  fromDate: string, // "YYYY-MM-DD" — comparaison lexicographique valide
  toDate: string,
) {
  return db
    .select()
    .from(exception)
    .where(
      and(
        eq(exception.practitionerId, practitionerId),
        gte(exception.date, fromDate),
        lte(exception.date, toDate),
      ),
    );
}

/** Remplace toutes les règles hebdo d'un praticien. */
export async function replaceAvailabilityRules(
  db: DbOrTx,
  practitionerId: string,
  rules: { id: string; weekday: number; startTime: string; endTime: string; roomId: string }[],
) {
  await db.delete(availabilityRule).where(eq(availabilityRule.practitionerId, practitionerId));
  for (const r of rules) {
    await db.insert(availabilityRule).values({ ...r, practitionerId });
  }
}

export async function createException(
  db: DbOrTx,
  data: {
    id: string;
    practitionerId: string;
    date: string;
    kind: string;
    startTime: string | null;
    endTime: string | null;
    fullDay: boolean;
    roomId: string | null;
    reason: string | null;
  },
) {
  await db.insert(exception).values(data);
  return data.id;
}

export async function deleteException(db: DbOrTx, id: string) {
  await db.delete(exception).where(eq(exception.id, id));
}
