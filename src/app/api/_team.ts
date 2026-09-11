import { NextResponse } from "next/server";

import * as membersDal from "@/dal/members";
import * as practitionersDal from "@/dal/practitioners";

/** Résout officeId + isOwner depuis un practitionerId (ou une réponse 404/403). */
export async function practitionerScope(
  practitionerId: string,
  userId: string,
): Promise<{ officeId: string; isOwner: boolean } | { error: NextResponse }> {
  const prac = await practitionersDal.getPractitionerById(practitionerId);
  if (!prac) {
    return { error: NextResponse.json({ error: "Praticien introuvable" }, { status: 404 }) };
  }
  const m = await membersDal.getMembership(prac.officeId, userId);
  if (!m || !m.active) {
    return { error: NextResponse.json({ error: "Action non autorisée" }, { status: 403 }) };
  }
  return { officeId: prac.officeId, isOwner: m.role === "owner" };
}

/** Vérifie le rôle owner sur un cabinet (ou une réponse 403). */
export async function requireOfficeOwner(
  officeId: string,
  userId: string,
): Promise<null | { error: NextResponse }> {
  const m = await membersDal.getMembership(officeId, userId);
  if (!m || m.role !== "owner" || !m.active) {
    return { error: NextResponse.json({ error: "Action non autorisée" }, { status: 403 }) };
  }
  return null;
}
