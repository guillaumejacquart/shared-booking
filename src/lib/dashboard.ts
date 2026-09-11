import { cache } from "react";
import { redirect } from "next/navigation";

import { db } from "@/db/client";
import * as membersDal from "@/dal/members";
import * as officesDal from "@/dal/offices";
import * as practitionersDal from "@/dal/practitioners";
import { getSession } from "@/lib/session";

/**
 * Contexte cabinet pour les pages `/dashboard` (server-only).
 * Non connecté → /login ; sans cabinet → /onboarding.
 * MVP : premier cabinet d'appartenance (sélecteur multi-cabinet plus tard).
 */
export interface DashboardContext {
  userId: string;
  userName: string;
  userEmail: string;
  officeId: string;
  officeSlug: string;
  officeName: string;
  officeTimezone: string;
  role: string;
  practitionerId: string;
  practitionerSlug: string;
}

export const getDashboardContext = cache(async (): Promise<DashboardContext> => {
  const session = await getSession();
  if (!session) redirect("/login");
  const memberships = await membersDal.listMemberships(db, session.user.id);
  if (memberships.length === 0) redirect("/onboarding");
  const membership = memberships[0];
  const office = await officesDal.getOfficeById(db, membership.officeId);
  const prac = await practitionersDal.getPractitionerByUserId(db, session.user.id);
  if (!office || !prac) redirect("/onboarding");
  return {
    userId: session.user.id,
    userName: session.user.name,
    userEmail: session.user.email,
    officeId: office.id,
    officeSlug: office.slug,
    officeName: office.name,
    officeTimezone: office.timezone,
    role: membership.role,
    practitionerId: prac.id,
    practitionerSlug: prac.slug,
  };
});
