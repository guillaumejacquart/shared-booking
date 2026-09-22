import { cache } from "react";
import { redirect } from "next/navigation";

import * as membersDal from "@/dal/members";
import * as officesDal from "@/dal/offices";
import * as practitionersDal from "@/dal/practitioners";
import * as preferencesDal from "@/dal/preferences";
import { getSession } from "@/lib/session";
import { parseMode, parsePalette } from "@/lib/theme";

/**
 * Contexte cabinet pour les pages `/dashboard` (server-only).
 * Non connecté → /login ; sans cabinet → /onboarding.
 * MVP : premier cabinet d'appartenance (sélecteur multi-cabinet plus tard).
 *
 * Thème effectif du backoffice = choix personnel (`userPalette`/`userMode`,
 * null si jamais choisi) sinon ambiance du cabinet (`officePalette`, mode
 * `system`). L'ambiance donne donc une identité cohérente à toute l'équipe,
 * chacun pouvant la surcharger via « Apparence ».
 */
export interface DashboardContext {
  userId: string;
  userName: string;
  userEmail: string;
  officeId: string;
  officeSlug: string;
  officeName: string;
  officeTimezone: string;
  officePalette: string;
  role: string;
  practitionerId: string;
  practitionerSlug: string;
  userPalette: string | null;
  userMode: string | null;
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
  const prefs = await preferencesDal.getPreferences(session.user.id);
  return {
    userId: session.user.id,
    userName: session.user.name,
    userEmail: session.user.email,
    officeId: office.id,
    officeSlug: office.slug,
    officeName: office.name,
    officeTimezone: office.timezone,
    officePalette: parsePalette(office.themePalette),
    role: membership.role,
    practitionerId: prac.id,
    practitionerSlug: prac.slug,
    // null = jamais choisi → le client retombe sur l'ambiance du cabinet.
    userPalette: prefs ? parsePalette(prefs.palette) : null,
    userMode: prefs ? parseMode(prefs.mode) : null,
  };
});
