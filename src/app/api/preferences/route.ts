import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import { withAuth } from "@/app/api/_auth";
import { readJsonBody } from "@/app/api/errors";
import { services } from "@/lib/container";
import { savePreferencesSchema } from "@/lib/schemas/preferences";
import {
  COOKIE_MODE,
  COOKIE_PALETTE,
  DEFAULT_MODE,
  DEFAULT_PALETTE,
} from "@/lib/theme";

/** Thème personnel du dashboard (palette + mode), persisté + cookie. */
export const GET = withAuth(async (user) => {
  const prefs = await services.preferences.get(user.id);
  return NextResponse.json({
    palette: prefs?.palette ?? DEFAULT_PALETTE,
    mode: prefs?.mode ?? DEFAULT_MODE,
  });
});

export const PATCH = withAuth(async (user, req: NextRequest) => {
  const body = await readJsonBody(req);
  const input = savePreferencesSchema.parse({
    ...body,
    requesterUserId: user.id,
  });
  await services.preferences.save(input);
  const store = await cookies();
  const year = 60 * 60 * 24 * 365;
  store.set(COOKIE_PALETTE, input.palette, {
    path: "/",
    maxAge: year,
    sameSite: "lax",
  });
  store.set(COOKIE_MODE, input.mode, {
    path: "/",
    maxAge: year,
    sameSite: "lax",
  });
  return NextResponse.json({ ok: true });
});
