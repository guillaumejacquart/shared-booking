import { gunzipSync } from "node:zlib";
import { mkdtempSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { HeadObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

import {
  backupFileName,
  filesToPrune,
  loadBackupConfig,
  runBackup,
  type BackupConfig,
} from "./backup";

const SAVED_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...SAVED_ENV };
});

/** Faux client S3 en mémoire (Put + Head uniquement). */
class FakeS3 {
  objects = new Map<string, Buffer>();
  heads: string[] = [];
  async send(cmd: unknown): Promise<Record<string, never>> {
    if (cmd instanceof PutObjectCommand) {
      const { Key, Body } = cmd.input as { Key?: string; Body?: Buffer };
      this.objects.set(Key ?? "unknown", Buffer.from(Body ?? Buffer.alloc(0)));
      return {};
    }
    if (cmd instanceof HeadObjectCommand) {
      return {};
    }
    throw new Error("commande inattendue");
  }
  destroy(): void {}
}

describe("backupFileName", () => {
  it("produit un stamp UTC triable", () => {
    expect(backupFileName(new Date("2026-09-08T01:05:00Z"))).toBe(
      "shared-booking-2026-09-08-0105.db.gz",
    );
  });
});

describe("filesToPrune", () => {
  it("garde les `keep` plus récentes, ignore les autres fichiers", () => {
    const files = [
      "shared-booking-2026-09-06-0300.db.gz",
      "notes.txt",
      "shared-booking-2026-09-08-0300.db.gz",
      "shared-booking-2026-09-07-0300.db.gz",
    ];
    expect(filesToPrune(files, 2)).toEqual(["shared-booking-2026-09-06-0300.db.gz"]);
    expect(filesToPrune(files, 7)).toEqual([]);
  });
});

describe("loadBackupConfig", () => {
  it("lit les valeurs et applique les défauts", () => {
    process.env.SQLITE_PATH = "/app/data/app.db";
    process.env.R2_ENDPOINT = "https://abc.r2.cloudflarestorage.com";
    process.env.R2_ACCESS_KEY_ID = "id";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    process.env.R2_BUCKET = "bkt";
    const config = loadBackupConfig();
    expect(config).toMatchObject({
      sqlitePath: "/app/data/app.db",
      backupDir: "/app/data/backups",
      keepLocal: 7,
      r2Prefix: "sqlite",
      schedule: "0 3 * * *",
      timezone: "Europe/Paris",
      runOnStartup: false,
    });
  });

  it("échoue sans les secrets R2 (scheduler éteint, pas de crash)", () => {
    delete process.env.R2_ENDPOINT;
    expect(() => loadBackupConfig()).toThrow("backup disabled: missing R2_ENDPOINT");
  });
});

describe("runBackup", () => {
  it("snapshotte, gzippe, envoie à S3 et purge les vieux fichiers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sb-backup-"));
    const dbPath = join(dir, "app.db");
    const live = new Database(dbPath);
    live.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t (v) VALUES ('hello');");
    live.close();

    const backupDir = join(dir, "backups");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(backupDir, { recursive: true });
    // 2 vieux fichiers : avec keepLocal=2 + le nouveau, le plus ancien part.
    writeFileSync(join(backupDir, "shared-booking-2026-09-01-0300.db.gz"), "old1");
    writeFileSync(join(backupDir, "shared-booking-2026-09-02-0300.db.gz"), "old2");

    const fake = new FakeS3();
    const config: BackupConfig = {
      sqlitePath: dbPath,
      backupDir,
      keepLocal: 2,
      r2Endpoint: "https://fake",
      r2AccessKeyId: "id",
      r2SecretAccessKey: "secret",
      r2Bucket: "bkt",
      r2Prefix: "sqlite",
      schedule: "0 3 * * *",
      timezone: "Europe/Paris",
      runOnStartup: false,
    };
    const before = new Set(readdirSync(tmpdir()));
    const key = await runBackup(config, { client: fake as unknown as S3Client });

    expect(key).toMatch(/^sqlite\/shared-booking-.*\.db\.gz$/);
    // Fichier local : décompresse en une base valide contenant la donnée.
    const localFiles = readdirSync(backupDir).filter((f) => f.endsWith(".db.gz") && !f.startsWith("shared-booking-2026-09-0"));
    expect(localFiles).toHaveLength(1);
    const { readFileSync, writeFileSync: writeSync } = await import("node:fs");
    const restoredPath = join(dir, "restored.db");
    writeSync(restoredPath, gunzipSync(readFileSync(join(backupDir, localFiles[0]))));
    const restored = new Database(restoredPath, { readonly: true });
    const row = restored.prepare("SELECT v FROM t").get() as { v: string };
    expect(row.v).toBe("hello");
    restored.close();
    // Purge : 09-01 supprimé, 09-02 + nouveau conservés.
    const remaining = readdirSync(backupDir).sort();
    expect(remaining).toHaveLength(2);
    expect(remaining.some((f) => f.includes("2026-09-01"))).toBe(false);
    // Staging nettoyé.
    const after = readdirSync(tmpdir()).filter((f) => f.startsWith("backup-staging-"));
    const leaked = after.filter((f) => !before.has(f));
    expect(leaked).toEqual([]);
    // S3 a reçu l'objet.
    expect(fake.objects.size).toBe(1);

    await rm(dir, { recursive: true, force: true });
  });
});
