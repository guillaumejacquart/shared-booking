import { getConnection } from "./connection";

import { and, eq } from "drizzle-orm";

import { office, practitioner, sessionType, sessionTypeVariant } from "@/db/schema";
import type { Office, Practitioner, SessionType, SessionTypeVariant } from "./types";

/** Repository praticiens (+ page publique). */

export interface PageSessionType extends SessionType {
  variants: SessionTypeVariant[];
}

export interface PractitionerPage {
  practitioner: Practitioner;
  office: Office;
  sessionTypes: PageSessionType[];
}

/** Page publique praticien : null si slug inconnu, praticien inactif ou pages désactivées. */
export async function getPractitionerPage(slug: string): Promise<PractitionerPage | null> {
  const conn = getConnection();
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
  const variants = types.length > 0
    ? await conn.select().from(sessionTypeVariant)
    : [];
  const byType = new Map<string, SessionTypeVariant[]>();
  for (const variant of variants) {
    const list = byType.get(variant.sessionTypeId) ?? [];
    list.push(variant);
    byType.set(variant.sessionTypeId, list);
  }
  for (const list of byType.values()) {
    list.sort((first, second) => first.sortOrder - second.sortOrder || first.durationMin - second.durationMin);
  }
  return {
    practitioner: prac,
    office: off,
    sessionTypes: types.map((sessionType) => ({
      ...sessionType,
      variants: byType.get(sessionType.id) ?? [],
    })),
  };
}

export async function getPractitionerById(practitionerId: string): Promise<Practitioner | null> {
  const conn = getConnection();
  const rows = await conn
    .select()
    .from(practitioner)
    .where(eq(practitioner.id, practitionerId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPractitionerBySlug(slug: string): Promise<Practitioner | null> {
  const conn = getConnection();
  const rows = await conn
    .select()
    .from(practitioner)
    .where(eq(practitioner.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPractitionerByUserId(userId: string): Promise<Practitioner | null> {
  const conn = getConnection();
  const rows = await conn
    .select()
    .from(practitioner)
    .where(eq(practitioner.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function listPractitionersByOffice(officeId: string) {
  const conn = getConnection();
  return conn
    .select()
    .from(practitioner)
    .where(and(eq(practitioner.officeId, officeId), eq(practitioner.active, true)));
}

/** Type de compte Connect : Express (créé par la plateforme) ou Standard (existant, OAuth). */
export type StripeAccountType = "express" | "standard";

/** Lie (ou met à jour) le compte Stripe Connect d'un praticien. */
export async function setPractitionerStripe(practitionerId: string, data: {
  stripeAccountId: string | null;
  stripeAccountType: StripeAccountType;
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
}) {
  const conn = getConnection();
  await conn.update(practitioner).set(data).where(eq(practitioner.id, practitionerId));
}

/** Retrouve le praticien propriétaire d'un compte Stripe Connect. */
export async function findPractitionerByStripeAccount(stripeAccountId: string): Promise<Practitioner | null> {
  const conn = getConnection();
  const rows = await conn
    .select()
    .from(practitioner)
    .where(eq(practitioner.stripeAccountId, stripeAccountId))
    .limit(1);
  return rows[0] ?? null;
}

export async function updatePractitioner(practitionerId: string,
  data: Partial<{
    displayName: string;
    slug: string;
    bio: string | null;
    publicContact: string | null;
    slotStepMin: number;
    requiresValidationDefault: boolean;
    onsitePaymentMethods: string;
    onsitePaymentNote: string | null;
    emailNote: string | null;
  }>) {
  const conn = getConnection();
  await conn.update(practitioner).set(data).where(eq(practitioner.id, practitionerId));
}
