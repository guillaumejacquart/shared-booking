import { cache } from "react";
import { redirect } from "next/navigation";

import * as bookingsDal from "@/dal/bookings";
import * as membersDal from "@/dal/members";
import * as officesDal from "@/dal/offices";
import * as practitionersDal from "@/dal/practitioners";
import * as usersDal from "@/dal/users";
import { getSession } from "@/lib/session";
import { parseMode, parsePalette } from "@/lib/theme";

/**
 * Contexte cabinet pour les pages `/dashboard` (server-only).
 * Non connecté → /login ; sans cabinet → /onboarding. Le cabinet affiché
 * est la sélection explicite (sélecteur multi-cabinet), sinon le premier
 * cabinet d'appartenance.
 *
 * Thème unique : le backoffice suit l'ambiance du cabinet
 * (`officePalette`/`officeThemeMode`), comme les pages publiques.
 */
export interface DashboardOffice {
  id: string;
  name: string;
  role: string;
}

export interface DashboardContext {
  userId: string;
  userName: string;
  userEmail: string;
  officeId: string;
  officeSlug: string;
  officeName: string;
  officeTimezone: string;
  officePalette: string;
  officeThemeMode: string;
  role: string;
  officePageEnabled: boolean;
  practitionerId: string;
  practitionerSlug: string;
  pendingCount: number;
  /** Cabinets d'appartenance active (sélecteur), premier en premier. */
  offices: DashboardOffice[];
}

export const getDashboardContext = cache(async (): Promise<DashboardContext> => {
  const session = await getSession();
  if (!session) redirect("/login");
  const memberships = await membersDal.listMemberships(session.user.id);
  const activeMemberships = memberships.filter((membership) => membership.active);
  if (activeMemberships.length === 0) redirect("/onboarding");
  const selectedOfficeId = await usersDal.getSelectedOfficeId(session.user.id);
  const membership =
    activeMemberships.find((candidate) => candidate.officeId === selectedOfficeId) ??
    activeMemberships[0];
  const office = await officesDal.getOfficeById(membership.officeId);
  const prac = await practitionersDal.getPractitionerByOfficeAndUser(membership.officeId, session.user.id);
  if (!office || !prac || !prac.active) redirect("/onboarding");
  const [pendingCount, officeRows] = await Promise.all([
    bookingsDal.countPendingValidationForPractitioner(prac.id),
    Promise.all(activeMemberships.map((entry) => officesDal.getOfficeById(entry.officeId))),
  ]);
  const offices: DashboardOffice[] = [];
  for (const entry of activeMemberships) {
    const candidate = officeRows.find((row) => row?.id === entry.officeId);
    if (candidate) offices.push({ id: candidate.id, name: candidate.name, role: entry.role });
  }
  return {
    userId: session.user.id,
    userName: session.user.name,
    userEmail: session.user.email,
    officeId: office.id,
    officeSlug: office.slug,
    officeName: office.name,
    officeTimezone: office.timezone,
    officePalette: parsePalette(office.themePalette),
    officeThemeMode: parseMode(office.themeMode),
    role: membership.role,
    officePageEnabled: office.enableOfficePage,
    practitionerId: prac.id,
    practitionerSlug: prac.slug,
    pendingCount,
    offices,
  };
});
