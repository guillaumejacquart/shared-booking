import { getConnection } from "./connection";

import { eq } from "drizzle-orm";

import { practitionerGoogle } from "@/db/schema";
import type { PractitionerGoogle } from "./types";

/** Préférences de push Google Agenda par praticien (outbound). */

export async function getGooglePrefs(
  practitionerId: string,
): Promise<PractitionerGoogle | null> {
  const conn = getConnection();
  const rows = await conn
    .select()
    .from(practitionerGoogle)
    .where(eq(practitionerGoogle.practitionerId, practitionerId))
    .limit(1);
  return rows[0] ?? null;
}

export interface GooglePrefsInput {
  syncEnabled?: boolean;
  calendarId?: string;
  showPatientName?: boolean;
  lastSyncAt?: Date | null;
  lastError?: string | null;
}

export async function saveGooglePrefs(
  practitionerId: string,
  data: GooglePrefsInput,
): Promise<PractitionerGoogle> {
  const conn = getConnection();
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (data.syncEnabled !== undefined)
    patch.syncEnabled = data.syncEnabled;
  if (data.calendarId !== undefined) patch.calendarId = data.calendarId;
  if (data.showPatientName !== undefined)
    patch.showPatientName = data.showPatientName;
  if (data.lastSyncAt !== undefined) patch.lastSyncAt = data.lastSyncAt;
  if (data.lastError !== undefined) patch.lastError = data.lastError;
  const rows = await conn
    .insert(practitionerGoogle)
    .values({ practitionerId, ...patch } as typeof practitionerGoogle.$inferInsert)
    .onConflictDoUpdate({
      target: practitionerGoogle.practitionerId,
      set: patch as Partial<typeof practitionerGoogle.$inferInsert>,
    })
    .returning();
  return rows[0];
}
