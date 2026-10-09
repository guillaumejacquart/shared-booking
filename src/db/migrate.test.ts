import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runMigrations } from "./migrate";

let dir = "";

/** Dossier de migrations minimal (rebuild d'une table référencée). */
function rebuildMigrationsFolder(): string {
  dir = mkdtempSync(join(tmpdir(), "sb-migrate-"));
  mkdirSync(join(dir, "meta"));
  writeFileSync(
    join(dir, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "sqlite",
      entries: [{ idx: 0, version: "6", when: 1, tag: "0000_rebuild", breakpoints: true }],
    }),
  );
  writeFileSync(
    join(dir, "0000_rebuild.sql"),
    [
      "PRAGMA foreign_keys=OFF;--> statement-breakpoint",
      "CREATE TABLE `__new_parent` (`id` text PRIMARY KEY NOT NULL, `mode` text DEFAULT 'light' NOT NULL);",
      "--> statement-breakpoint",
      'INSERT INTO `__new_parent`("id", "mode") SELECT "id", "mode" FROM `parent`;--> statement-breakpoint',
      "DROP TABLE `parent`;--> statement-breakpoint",
      "ALTER TABLE `__new_parent` RENAME TO `parent`;--> statement-breakpoint",
      "PRAGMA foreign_keys=ON;",
    ].join("\n"),
  );
  return dir;
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("runMigrations", () => {
  it("rebuild d'une table référencée sur base peuplée : données préservées", () => {
    const folder = rebuildMigrationsFolder();
    const dbPath = join(folder, "scratch.db");
    const setup = new Database(dbPath);
    setup.pragma("foreign_keys = ON");
    setup.exec(
      "CREATE TABLE parent (id TEXT PRIMARY KEY NOT NULL, mode TEXT DEFAULT 'system' NOT NULL);" +
        "CREATE TABLE child (id TEXT PRIMARY KEY NOT NULL, parent_id TEXT NOT NULL REFERENCES parent(id));" +
        "INSERT INTO parent (id, mode) VALUES ('p1', 'system');" +
        "INSERT INTO child (id, parent_id) VALUES ('c1', 'p1');",
    );
    setup.close();

    expect(() => runMigrations(dbPath, folder)).not.toThrow();

    const check = new Database(dbPath, { readonly: true });
    expect(check.prepare("SELECT id, mode FROM parent").all()).toEqual([{ id: "p1", mode: "system" }]);
    expect(check.prepare("SELECT id, parent_id FROM child").all()).toEqual([{ id: "c1", parent_id: "p1" }]);
    expect(
      check.prepare("SELECT dflt_value FROM pragma_table_info('parent') WHERE name = 'mode'").get(),
    ).toEqual({ dflt_value: "'light'" });
    check.close();
  });
});
