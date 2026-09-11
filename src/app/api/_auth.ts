import { NextResponse } from "next/server";

import { getSession } from "@/lib/session";

/** Utilisateur connecté ou null (la route répond 401). */
export async function getAuthUser() {
  const session = await getSession();
  return session?.user ?? null;
}

export function unauthorized() {
  return NextResponse.json({ error: "Connexion requise" }, { status: 401 });
}
