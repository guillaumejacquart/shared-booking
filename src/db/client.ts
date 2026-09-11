import { createRequire } from "node:module";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import { env } from "@/lib/env";
import * as schema from "./schema";

/** Fabrique de client SQLite (better-sqlite3). */

type Schema = typeof schema;
export type DrizzleDb = BetterSQLite3Database<Schema>;

function createDb(): DrizzleDb {
  const Database = createRequire(import.meta.url)("better-sqlite3");
  const sqlite = new Database(env.SQLITE_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

/**
 * Connexion paresseuse : on n'ouvre la base qu'au premier usage réel (au moment
 * d'une requête), jamais à l'import. Cela évite que les workers du build Next
 * ouvrent tous le fichier SQLite simultanément (→ SQLITE_BUSY).
 */
let instance: DrizzleDb | null = null;
function getDb(): DrizzleDb {
  if (!instance) instance = createDb();
  return instance;
}

export const db = new Proxy({} as DrizzleDb, {
  get(_target, prop, receiver) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
