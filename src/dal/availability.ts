import { getConnection } from "./connection";

import { and, eq, gte, lte } from "drizzle-orm";

import { availabilityRule, exception } from "@/db/schema";

/** Repository disponibilités : règles hebdo + exceptions. */

export async function listRules(practitionerId: string) {
  const conn = getConnection();
  return conn
    .select()
    .from(availabilityRule)
    .where(eq(availabilityRule.practitionerId, practitionerId));
}

export async function listExceptions(practitionerId: string,
  fromDate: string, // "YYYY-MM-DD" — comparaison lexicographique valide
  toDate: string) {
  const conn = getConnection();
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

/** Remplace toutes les règles hebdo d'un praticien (fenêtres sans salle). */
export async function replaceAvailabilityRules(practitionerId: string,
  rules: { id: string; weekday: number; startTime: string; endTime: string }[]) {
  const conn = getConnection();
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
  }) {
  const conn = getConnection();
  await conn.insert(exception).values(data);
  return data.id;
}

export async function deleteException(id: string) {
  const conn = getConnection();
  await conn.delete(exception).where(eq(exception.id, id));
}
