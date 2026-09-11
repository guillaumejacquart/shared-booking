import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "@/db/schema";
import type { Db } from "@/dal/types";

/**
 * Base SQLite `:memory:` + toutes les migrations appliquées, pour les tests.
 * Chaque test part d'une base vierge (voir `beforeEach`).
 */
export function createMemoryDb(): Db {
  const Database = createRequire(import.meta.url)("better-sqlite3");
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const files = readdirSync("drizzle").filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    sqlite.exec(readFileSync(`drizzle/${f}`, "utf8"));
  }
  return drizzle(sqlite, { schema }) as Db;
}
