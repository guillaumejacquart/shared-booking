import { db } from "@/db/client";
import type { DbOrTx } from "./types";

/**
 * Connexion détenue par le DAL.
 *
 * - En production : le proxy paresseux `@/db/client` (jamais ouvert à l'import).
 * - En tests : `setConnection()` l'échange contre une base `:memory:` vierge.
 *
 * Sous `VITEST`, aucune connexion par défaut : un test qui oublie
 * `setConnection()` échoue bruyamment au lieu d'écrire dans la base locale.
 */
let current: DbOrTx | null = process.env.VITEST ? null : db;

export function getConnection(): DbOrTx {
  if (!current) {
    throw new Error("DAL sans connexion : appeler setConnection() (tests) — la prod câble db/client.");
  }
  return current;
}

/** Échange la connexion du DAL (tests uniquement). */
export function setConnection(conn: DbOrTx): void {
  current = conn;
}
