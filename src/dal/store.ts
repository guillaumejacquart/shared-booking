/**
 * Barillet de compatibilité — NE PAS étendre.
 *
 * Le DAL est découpé par repository (`bookings`, `practitioners`, `offices`,
 * `session-types`, `availability`, `rooms`, `members`, `invites`, `users`).
 * Le code existant importe encore d'ici ; le nouveau code importe directement
 * depuis le repository concerné, ex. `import * as bookingsDal from "@/dal/bookings"`.
 */
export * from "./availability";
export * from "./bookings";
export * from "./invites";
export * from "./members";
export * from "./offices";
export * from "./practitioners";
export * from "./rooms";
export * from "./session-types";
export * from "./types";
export * from "./users";
