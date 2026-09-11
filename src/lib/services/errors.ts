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
