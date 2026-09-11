import { existsSync } from "node:fs";
import { createRequire } from "node:module";

import { runMigrations } from "./migrate";

/**
 * Garantit une base exploitable en développement (`next dev`).
 *
 * - Fichier absent ou sans tables → applique les migrations Drizzle.
 * - Base existante mais incomplète (ex. après `git pull` avec nouvelle
 *   migration) → on ne migre PAS (risque de conflit avec `db:push`),
 *   on affiche la commande à lancer.
 * - Production : no-op (l'entrypoint Docker migre déjà).
 */
const EXPECTED = [
  "user",
  "session",
  "account",
  "verification",
  "office",
  "member",
  "practitioner",
  "room",
  "room_member",
  "session_type",
  "availability_rule",
  "exception",
  "booking",
  "invite",
];

export function ensureDevDatabase(): void {
  if (process.env.NODE_ENV === "production") return;
  const dbPath = process.env.SQLITE_PATH ?? "./local.db";

  if (!existsSync(dbPath)) {
    runMigrations(dbPath);
    return;
  }
  const Database = createRequire(import.meta.url)("better-sqlite3");
  const sqlite = new Database(dbPath, { readonly: true });
  try {
    const rows = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    const names = new Set(rows.map((r) => r.name));
    if (!names.has("user")) {
      sqlite.close();
      runMigrations(dbPath);
      return;
    }
    const missing = EXPECTED.filter((t) => !names.has(t));
    if (missing.length > 0) {
      console.warn(
        `[db] tables manquantes (${missing.join(", ")}) : lancez \`npm run db:push\` puis relancez.`,
      );
    }
  } finally {
    if (sqlite.open) sqlite.close();
  }
}
