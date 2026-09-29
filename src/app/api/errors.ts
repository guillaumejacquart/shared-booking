import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  ConflictError,
  DeadlineError,
  errorToHttp,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/services/errors";

/**
 * Mappe les erreurs métier vers des réponses HTTP structurées :
 * `{ error: message, code, details? }`. Le `code` stable aide au diagnostic
 * côté client/logs ; en dev, les erreurs inconnues incluent aussi le message
 * d'origine (jamais de stack trace vers le client).
 */
export function toResponse(error: unknown): NextResponse {
  const dev = process.env.NODE_ENV !== "production";
  if (
    error instanceof NotFoundError ||
    error instanceof ValidationError ||
    error instanceof ConflictError ||
    error instanceof DeadlineError ||
    error instanceof ForbiddenError
  ) {
    const { status, code } = errorToHttp(error);
    return NextResponse.json(
      {
        error: error.message,
        code,
        ...(error instanceof ValidationError && error.details ? { details: error.details } : {}),
      },
      { status },
    );
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: error.issues[0]?.message ?? "Requête invalide",
        code: "VALIDATION",
        details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
      { status: 400 },
    );
  }
  console.error("[api]", error);
  const message =
    dev && error instanceof Error && error.message ? error.message : "Erreur interne";
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
    } catch (error) {
      return toResponse(error);
    }
  };
}
