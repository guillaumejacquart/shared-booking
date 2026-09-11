import { db } from "@/db/client";

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
export async function getPractitionerPage(slug: string,
  tx?: DbOrTx): Promise<PractitionerPage | null> {
  const conn = tx ?? db;
  const rows = await conn
    .select()
    .from(practitioner)
    .where(and(eq(practitioner.slug, slug), eq(practitioner.active, true)))
    .limit(1);
  const prac = rows[0];
  if (!prac) return null;

  const officeRows = await conn
    .select()
    .from(office)
    .where(eq(office.id, prac.officeId))
    .limit(1);
  const off = officeRows[0];
  if (!off || !off.enablePractitionerPages) return null;

  const types = await conn
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

export async function getPractitionerById(practitionerId: string,
  tx?: DbOrTx): Promise<Practitioner | null> {
  const conn = tx ?? db;
  const rows = await conn
    .select()
    .from(practitioner)
    .where(eq(practitioner.id, practitionerId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPractitionerBySlug(slug: string,
  tx?: DbOrTx): Promise<Practitioner | null> {
  const conn = tx ?? db;
  const rows = await conn
    .select()
    .from(practitioner)
    .where(eq(practitioner.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPractitionerByUserId(userId: string,
  tx?: DbOrTx): Promise<Practitioner | null> {
  const conn = tx ?? db;
  const rows = await conn
    .select()
    .from(practitioner)
    .where(eq(practitioner.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function listPractitionersByOffice(officeId: string,
  tx?: DbOrTx) {
  const conn = tx ?? db;
  return conn
    .select()
    .from(practitioner)
    .where(and(eq(practitioner.officeId, officeId), eq(practitioner.active, true)));
}

export async function updatePractitioner(practitionerId: string,
  data: Partial<{
    displayName: string;
    slug: string;
    bio: string | null;
    publicContact: string | null;
  }>,
  tx?: DbOrTx) {
  const conn = tx ?? db;
  await conn.update(practitioner).set(data).where(eq(practitioner.id, practitionerId));
}
