import { NextResponse } from "next/server";

import { db } from "@/db/client";
import * as store from "@/dal/store";

/** Résout officeId + isOwner depuis un practitionerId (ou une réponse 404/403). */
export async function practitionerScope(
  practitionerId: string,
  userId: string,
): Promise<{ officeId: string; isOwner: boolean } | { error: NextResponse }> {
  const prac = await store.getPractitionerById(db, practitionerId);
  if (!prac) {
    return { error: NextResponse.json({ error: "Praticien introuvable" }, { status: 404 }) };
  }
  const m = await store.getMembership(db, prac.officeId, userId);
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
  const m = await store.getMembership(db, officeId, userId);
  if (!m || m.role !== "owner" || !m.active) {
    return { error: NextResponse.json({ error: "Action non autorisée" }, { status: 403 }) };
  }
  return null;
}
