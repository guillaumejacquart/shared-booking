import { db } from "@/db/client";

import { and, eq, gte, lte } from "drizzle-orm";

import { availabilityRule, exception } from "@/db/schema";
import type { DbOrTx } from "./types";

/** Repository disponibilités : règles hebdo + exceptions. */

export async function listRules(practitionerId: string,
  tx?: DbOrTx) {
  const conn = tx ?? db;
  return conn
    .select()
    .from(availabilityRule)
    .where(eq(availabilityRule.practitionerId, practitionerId));
}

export async function countRulesByRoom(roomId: string,
  tx?: DbOrTx): Promise<number> {
  const conn = tx ?? db;
  const rows = await conn
    .select({ id: availabilityRule.id })
    .from(availabilityRule)
    .where(eq(availabilityRule.roomId, roomId));
  return rows.length;
}

export async function listExceptions(practitionerId: string,
  fromDate: string, // "YYYY-MM-DD" — comparaison lexicographique valide
  toDate: string,
  tx?: DbOrTx) {
  const conn = tx ?? db;
  return conn
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
export async function replaceAvailabilityRules(practitionerId: string,
  rules: { id: string; weekday: number; startTime: string; endTime: string; roomId: string }[],
  tx?: DbOrTx) {
  const conn = tx ?? db;
  await conn.delete(availabilityRule).where(eq(availabilityRule.practitionerId, practitionerId));
  for (const r of rules) {
    await conn.insert(availabilityRule).values({ ...r, practitionerId });
  }
}

export async function createException(data: {
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
  tx?: DbOrTx) {
  const conn = tx ?? db;
  await conn.insert(exception).values(data);
  return data.id;
}

export async function deleteException(id: string,
  tx?: DbOrTx) {
  const conn = tx ?? db;
  await conn.delete(exception).where(eq(exception.id, id));
}
