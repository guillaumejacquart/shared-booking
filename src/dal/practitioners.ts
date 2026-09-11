import { and, eq } from "drizzle-orm";

import { office, practitioner, sessionType } from "@/db/schema";
import type { DbOrTx, Office, Practitioner, SessionType } from "./types";

/** Repository praticiens (+ page publique). */

export interface PractitionerPage {
  practitioner: Practitioner;
  office: Office;
  sessionTypes: SessionType[];
}

/** Page publique praticien : null si slug inconnu, praticien inactif ou pages désactivées. */
export async function getPractitionerPage(
  db: DbOrTx,
  slug: string,
): Promise<PractitionerPage | null> {
  const rows = await db
    .select()
    .from(practitioner)
    .where(and(eq(practitioner.slug, slug), eq(practitioner.active, true)))
    .limit(1);
  const prac = rows[0];
  if (!prac) return null;

  const officeRows = await db
    .select()
    .from(office)
    .where(eq(office.id, prac.officeId))
    .limit(1);
  const off = officeRows[0];
  if (!off || !off.enablePractitionerPages) return null;

  const types = await db
    .select()
    .from(sessionType)
    .where(
      and(
        eq(sessionType.practitionerId, prac.id),
        eq(sessionType.active, true),
      ),
    );
  return { practitioner: prac, office: off, sessionTypes: types };
}

export async function getPractitionerById(
  db: DbOrTx,
  practitionerId: string,
): Promise<Practitioner | null> {
  const rows = await db
    .select()
    .from(practitioner)
    .where(eq(practitioner.id, practitionerId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPractitionerBySlug(
  db: DbOrTx,
  slug: string,
): Promise<Practitioner | null> {
  const rows = await db
    .select()
    .from(practitioner)
    .where(eq(practitioner.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPractitionerByUserId(
  db: DbOrTx,
  userId: string,
): Promise<Practitioner | null> {
  const rows = await db
    .select()
    .from(practitioner)
    .where(eq(practitioner.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function listPractitionersByOffice(db: DbOrTx, officeId: string) {
  return db
    .select()
    .from(practitioner)
    .where(and(eq(practitioner.officeId, officeId), eq(practitioner.active, true)));
}

export async function updatePractitioner(
  db: DbOrTx,
  practitionerId: string,
  data: Partial<{
    displayName: string;
    slug: string;
    bio: string | null;
    publicContact: string | null;
  }>,
) {
  await db.update(practitioner).set(data).where(eq(practitioner.id, practitionerId));
}
