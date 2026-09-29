import { NextResponse } from "next/server";

import { withAuth } from "@/app/api/_auth";
import { services } from "@/lib/container";

/** Déconnexion du compte Google (coupe aussi le push). */
export const DELETE = withAuth(async (user) => {
  await services.google.disconnectGoogle(user.id);
  return NextResponse.json({ ok: true });
});

/** Resynchronise les push en échec du praticien. */
export const POST = withAuth(async (user) => {
  return NextResponse.json(await services.google.resyncGoogle(user.id));
});
