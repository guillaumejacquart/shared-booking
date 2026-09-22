export class NotFoundError extends Error {
  statusCode = 404 as const;
  code = "NOT_FOUND" as const;
  constructor(message = "Ressource introuvable") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  statusCode = 400 as const;
  code = "VALIDATION" as const;
  details?: { path: string; message: string }[];
  constructor(message: string, details?: { path: string; message: string }[]) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}

export class ConflictError extends Error {
  statusCode = 409 as const;
  code = "CONFLICT" as const;
  constructor(message = "Créneau déjà réservé") {
    super(message);
    this.name = "ConflictError";
  }
}

/** Action plus possible (ex. annulation après la deadline). */
export class DeadlineError extends Error {
  statusCode = 410 as const;
  code = "DEADLINE" as const;
  constructor(message: string) {
    super(message);
    this.name = "DeadlineError";
  }
}

/** Action interdite pour ce rôle (ex. inviter sans être owner). */
export class ForbiddenError extends Error {
  statusCode = 403 as const;
  code = "FORBIDDEN" as const;
  constructor(message = "Action non autorisée") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export type ServiceError =
  | NotFoundError
  | ValidationError
  | ConflictError
  | DeadlineError
  | ForbiddenError;

/** Convertit une erreur métier en statut HTTP + code stable. */
export function errorToHttp(e: ServiceError): { status: number; code: string } {
  return { status: e.statusCode, code: e.code };
}
