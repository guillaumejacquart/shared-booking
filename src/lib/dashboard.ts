import { cache } from "react";
import { redirect } from "next/navigation";

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
  const memberships = await membersDal.listMemberships(session.user.id);
  const membership = memberships.find((m) => m.active);
  if (!membership) redirect("/onboarding");
  const office = await officesDal.getOfficeById(membership.officeId);
  const prac = await practitionersDal.getPractitionerByUserId(session.user.id);
  if (!office || !prac || !prac.active) redirect("/onboarding");
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
