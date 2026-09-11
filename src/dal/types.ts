import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import type * as schema from "@/db/schema";

/**
 * Types de la couche d'accès aux données.
 *
 * `Db` = connexion, `Tx` = transaction : les fonctions du store acceptent les
 * deux, ce qui permet les vérifications atomiques (conflit + insertion dans la
 * même transaction) et les tests sur base `:memory:`.
 */
export type Db = BetterSQLite3Database<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export type Office = typeof schema.office.$inferSelect;
export type Practitioner = typeof schema.practitioner.$inferSelect;
export type SessionType = typeof schema.sessionType.$inferSelect;
export type AvailabilityRule = typeof schema.availabilityRule.$inferSelect;
export type DayException = typeof schema.exception.$inferSelect;
export type Booking = typeof schema.booking.$inferSelect;
export type Room = typeof schema.room.$inferSelect;
