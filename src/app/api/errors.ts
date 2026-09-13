import { NextRequest, NextResponse } from "next/server";
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

/**
 * Corps JSON supposé objet ; 400 si le corps n'est pas du JSON valide.
 * Un JSON valide mais non-objet (tableau, chaîne) donne `{}`, que les schémas
 * Zod rejettent ensuite champ par champ.
 */
export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ValidationError("Requête invalide");
  }
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

/** Enveloppe un Route Handler public : toute erreur devient une réponse HTTP. */
export function route<Rest extends unknown[]>(
  handler: (req: NextRequest, ...rest: Rest) => Promise<NextResponse>,
): (req: NextRequest, ...rest: Rest) => Promise<NextResponse> {
  return async (req, ...rest) => {
    try {
      return await handler(req, ...rest);
    } catch (e) {
      return toResponse(e);
    }
  };
}
