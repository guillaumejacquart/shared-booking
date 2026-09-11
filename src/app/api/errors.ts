import { NextResponse } from "next/server";
import { z } from "zod";

import {
  ConflictError,
  DeadlineError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/services/errors";

/**
 * Mappe les erreurs métier vers des réponses HTTP structurées :
 * `{ error: message, code, details? }`. Le `code` stable aide au diagnostic
 * côté client/logs ; en dev, les erreurs inconnues incluent aussi le message
 * d'origine (jamais de stack trace vers le client).
 */
export function toResponse(e: unknown): NextResponse {
  const dev = process.env.NODE_ENV !== "production";
  if (e instanceof NotFoundError) {
    return NextResponse.json({ error: e.message, code: "NOT_FOUND" }, { status: 404 });
  }
  if (e instanceof ValidationError) {
    return NextResponse.json(
      {
        error: e.message,
        code: "VALIDATION",
        ...(e.details ? { details: e.details } : {}),
      },
      { status: 400 },
    );
  }
  if (e instanceof ConflictError) {
    return NextResponse.json({ error: e.message, code: "CONFLICT" }, { status: 409 });
  }
  if (e instanceof DeadlineError) {
    return NextResponse.json({ error: e.message, code: "DEADLINE" }, { status: 410 });
  }
  if (e instanceof ForbiddenError) {
    return NextResponse.json({ error: e.message, code: "FORBIDDEN" }, { status: 403 });
  }
  if (e instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: e.issues[0]?.message ?? "Requête invalide",
        code: "VALIDATION",
        details: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      { status: 400 },
    );
  }
  console.error("[api]", e);
  const message =
    dev && e instanceof Error && e.message ? e.message : "Erreur interne";
  return NextResponse.json({ error: message, code: "INTERNAL" }, { status: 500 });
}
