import { and, eq } from "drizzle-orm";

import { member, office, practitioner, sessionType } from "@/db/schema";
import type { DbOrTx, Office, Practitioner, SessionType } from "./types";

/** Repository cabinets (+ page publique). */

export async function getOfficeById(
  db: DbOrTx,
  officeId: string,
): Promise<Office | null> {
  const rows = await db
    .select()
    .from(office)
    .where(eq(office.id, officeId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getOfficeBySlug(
  db: DbOrTx,
  slug: string,
): Promise<Office | null> {
  const rows = await db
    .select()
    .from(office)
    .where(eq(office.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

/** Création complète d'un cabinet (office + membre + praticien). */
export async function createOffice(
  db: DbOrTx,
  data: {
    office: { id: string; name: string; slug: string; address: string | null };
    member: { id: string; officeId: string; userId: string; role: string };
    practitioner: {
      id: string;
      officeId: string;
      userId: string;
      displayName: string;
      slug: string;
    };
  },
) {
  await db.insert(office).values(data.office);
  await db.insert(member).values({ ...data.member, active: true });
  await db.insert(practitioner).values({ ...data.practitioner, active: true });
}

export async function updateOffice(
  db: DbOrTx,
  officeId: string,
  data: Partial<{
    name: string;
    address: string | null;
    enablePractitionerPages: boolean;
    enableOfficePage: boolean;
    bookingLeadTimeMin: number;
    cancelDeadlineHours: number;
    reminderHoursBefore: number;
    defaultBufferAfterMin: number;
  }>,
) {
  await db.update(office).set(data).where(eq(office.id, officeId));
}

export interface OfficePageData {
  office: Office;
  practitioners: { practitioner: Practitioner; sessionTypes: SessionType[] }[];
}

/** Page publique du cabinet : null si slug inconnu ou page désactivée. */
export async function getOfficePage(
  db: DbOrTx,
  slug: string,
): Promise<OfficePageData | null> {
  const officeRows = await db
    .select()
    .from(office)
    .where(eq(office.slug, slug))
    .limit(1);
  const off = officeRows[0];
  if (!off || !off.enableOfficePage) return null;
  const pracs = await db
    .select()
    .from(practitioner)
    .where(and(eq(practitioner.officeId, off.id), eq(practitioner.active, true)));
  const result: OfficePageData["practitioners"] = [];
  for (const prac of pracs) {
    const types = await db
      .select()
      .from(sessionType)
      .where(and(eq(sessionType.practitionerId, prac.id), eq(sessionType.active, true)));
    result.push({ practitioner: prac, sessionTypes: types });
  }
  return { office: off, practitioners: result };
}
