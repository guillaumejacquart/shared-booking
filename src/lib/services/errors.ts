import { z } from "zod";

export class NotFoundError extends Error {
  constructor(message = "Ressource introuvable") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  details?: { path: string; message: string }[];
  constructor(message: string, details?: { path: string; message: string }[]) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}

export class ConflictError extends Error {
  constructor(message = "Créneau déjà réservé") {
    super(message);
    this.name = "ConflictError";
  }
}

/** Action plus possible (ex. annulation après la deadline). */
export class DeadlineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeadlineError";
  }
}

/** Action interdite pour ce rôle (ex. inviter sans être owner). */
export class ForbiddenError extends Error {
  constructor(message = "Action non autorisée") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Message de validation enrichi du champ fautif (diagnostic client/logs). */
export function validationMessage(fallback: string, e: unknown): string {
  if (e instanceof z.ZodError) {
    const first = e.issues[0];
    const path = first && first.path.length > 0 ? first.path.join(".") : "?";
    return `${fallback} (${path} : ${first?.message ?? "invalide"})`;
  }
  return fallback;
}

/** Détail structuré d'une erreur Zod (champ fautif), pour la réponse API. */
export function validationDetails(e: unknown): { path: string; message: string }[] | undefined {
  if (e instanceof z.ZodError) {
    return e.issues.map((i) => ({
      path: i.path.length > 0 ? i.path.join(".") : "?",
      message: i.message,
    }));
  }
  return undefined;
}

/** Construit l'erreur de validation complète (message + détails). */
export function validationError(fallback: string, e: unknown): ValidationError {
  return new ValidationError(validationMessage(fallback, e), validationDetails(e));
}
