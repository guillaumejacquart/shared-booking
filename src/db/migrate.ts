/**
 * Applique les migrations SQLite au démarrage du conteneur.
 *
 * Exécuté par `docker-entrypoint.sh` avant le serveur Next, via le strip-types
 * natif de Node 24 (`node src/db/migrate.ts`). Volontairement autonome : pas
 * d'import de `@/lib/env` ni du schéma, seul le chemin du fichier est requis.
 */
import { createRequire } from "node:module";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const Database = createRequire(import.meta.url)("better-sqlite3");

/** Applique les migrations Drizzle sur le fichier SQLite indiqué. */
export function runMigrations(dbPath: string, migrationsFolder = "drizzle"): void {
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  migrate(drizzle(sqlite), { migrationsFolder });
  sqlite.close();
  console.log(`✓ Migrations SQLite appliquées (${dbPath})`);
}

// Exécution directe : `node src/db/migrate.ts` (strip-types natif Node 24).
if (process.argv[1]?.endsWith("migrate.ts")) {
  runMigrations(process.env.SQLITE_PATH ?? "./local.db");
}
