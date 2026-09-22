import { getConnection } from "./connection";

import { and, eq } from "drizzle-orm";

import { member, office, practitioner, sessionType } from "@/db/schema";
import type { Office, Practitioner, SessionType } from "./types";

/** Repository cabinets (+ page publique). */

export async function getOfficeById(officeId: string): Promise<Office | null> {
  const conn = getConnection();
  const rows = await conn
    .select()
    .from(office)
    .where(eq(office.id, officeId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getOfficeBySlug(slug: string): Promise<Office | null> {
  const conn = getConnection();
  const rows = await conn
    .select()
    .from(office)
    .where(eq(office.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

/** Création complète d'un cabinet (office + membre + praticien). */
export async function createOffice(data: {
    office: { id: string; name: string; slug: string; address: string | null };
    member: { id: string; officeId: string; userId: string; role: string };
    practitioner: {
      id: string;
      officeId: string;
      userId: string;
      displayName: string;
      slug: string;
    };
  }) {
  const conn = getConnection();
  await conn.insert(office).values(data.office);
  await conn.insert(member).values({ ...data.member, active: true });
  await conn.insert(practitioner).values({ ...data.practitioner, active: true });
}

export async function updateOffice(officeId: string,
  data: Partial<{
    name: string;
    address: string | null;
    enablePractitionerPages: boolean;
    enableOfficePage: boolean;
    bookingLeadTimeMin: number;
    cancelDeadlineHours: number;
    reminderHoursBefore: number;
    defaultBufferAfterMin: number;
    themePalette: string;
    themeMode: string;
  }>) {
  const conn = getConnection();
  await conn.update(office).set(data).where(eq(office.id, officeId));
}

export interface OfficePageData {
  office: Office;
  practitioners: { practitioner: Practitioner; sessionTypes: SessionType[] }[];
}

/** Page publique du cabinet : null si slug inconnu ou page désactivée. */
export async function getOfficePage(slug: string): Promise<OfficePageData | null> {
  const conn = getConnection();
  const officeRows = await conn
    .select()
    .from(office)
    .where(eq(office.slug, slug))
    .limit(1);
  const off = officeRows[0];
  if (!off || !off.enableOfficePage) return null;
  const pracs = await conn
    .select()
    .from(practitioner)
    .where(and(eq(practitioner.officeId, off.id), eq(practitioner.active, true)));
  const result: OfficePageData["practitioners"] = [];
  for (const prac of pracs) {
    const types = await conn
      .select()
      .from(sessionType)
      .where(and(eq(sessionType.practitionerId, prac.id), eq(sessionType.active, true)));
    result.push({ practitioner: prac, sessionTypes: types });
  }
  return { office: off, practitioners: result };
}
