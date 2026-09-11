import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import Database from "better-sqlite3";
import cron from "node-cron";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface BackupConfig {
  sqlitePath: string;
  backupDir: string;
  keepLocal: number;
  r2Endpoint: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  r2Bucket: string;
  r2Prefix: string;
  schedule: string;
  timezone: string;
  runOnStartup: boolean;
}

const FILE_PREFIX = "shared-booking-";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`backup disabled: missing ${name}`);
  return value;
}

// Local copies sit next to the live db, inside the same persisted volume.
export function defaultBackupDir(sqlitePath: string): string {
  return join(dirname(sqlitePath), "backups");
}

export function loadBackupConfig(): BackupConfig {
  const sqlitePath = process.env.SQLITE_PATH ?? "./local.db";
  return {
    sqlitePath,
    backupDir: process.env.BACKUP_DIR ?? defaultBackupDir(sqlitePath),
    keepLocal: Number(process.env.BACKUP_KEEP_LOCAL ?? 7),
    r2Endpoint: required("R2_ENDPOINT"),
    r2AccessKeyId: required("R2_ACCESS_KEY_ID"),
    r2SecretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    r2Bucket: required("R2_BUCKET"),
    r2Prefix: process.env.R2_PREFIX ?? "sqlite",
    schedule: process.env.BACKUP_SCHEDULE ?? "0 3 * * *",
    timezone: process.env.BACKUP_TIMEZONE ?? "Europe/Paris",
    runOnStartup: process.env.BACKUP_ON_STARTUP === "true",
  };
}

// UTC stamp keeps names sortable regardless of container timezone.
export function backupFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${FILE_PREFIX}${now.getUTCFullYear()}-${p(now.getUTCMonth() + 1)}-${p(now.getUTCDate())}` +
    `-${p(now.getUTCHours())}${p(now.getUTCMinutes())}.db.gz`
  );
}

// Newest first by name (fixed-width stamp), extras past `keep` get deleted.
export function filesToPrune(files: string[], keep: number): string[] {
  return files
    .filter((f) => f.startsWith(FILE_PREFIX) && f.endsWith(".db.gz"))
    .sort()
    .reverse()
    .slice(keep);
}

// SQLite backup API merges WAL safely, unlike cp on a live db.
async function snapshotDatabase(sqlitePath: string, destPath: string): Promise<void> {
  const src = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  try {
    src.pragma("busy_timeout = 5000");
    await src.backup(destPath);
  } finally {
    src.close();
  }
  const check = new Database(destPath, { readonly: true });
  try {
    const row = check.prepare("PRAGMA integrity_check;").get() as { integrity_check: string };
    if (row.integrity_check !== "ok") throw new Error(`backup corrupt: ${row.integrity_check}`);
  } finally {
    check.close();
  }
}

function r2Client(config: BackupConfig): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: config.r2Endpoint,
    credentials: {
      accessKeyId: config.r2AccessKeyId,
      secretAccessKey: config.r2SecretAccessKey,
    },
  });
}

export async function runBackup(
  config: BackupConfig = loadBackupConfig(),
  deps: { client?: S3Client } = {},
): Promise<string> {
  const now = new Date();
  const name = backupFileName(now);
  const key = `${config.r2Prefix}/${name}`;
  await mkdir(config.backupDir, { recursive: true });

  const staging = join(tmpdir(), `backup-staging-${Date.now()}.db`);
  try {
    await snapshotDatabase(config.sqlitePath, staging);
    const gzipped = gzipSync(await readFile(staging));
    await writeFile(join(config.backupDir, name), gzipped);

    const client = deps.client ?? r2Client(config);
    await client.send(
      new PutObjectCommand({
        Bucket: config.r2Bucket,
        Key: key,
        Body: gzipped,
        ContentType: "application/gzip",
      }),
    );
    await client.send(new HeadObjectCommand({ Bucket: config.r2Bucket, Key: key }));
    client.destroy();
  } finally {
    await rm(staging, { force: true });
  }

  const files = await readdir(config.backupDir);
  for (const old of filesToPrune(files, config.keepLocal)) {
    await rm(join(config.backupDir, old), { force: true });
  }
  return key;
}

let running = false;

async function runOnce(config: BackupConfig): Promise<void> {
  if (running) {
    console.log("backup skipped: previous run still in progress");
    return;
  }
  running = true;
  try {
    const key = await runBackup(config);
    console.log(`backup ok: ${key}`);
  } catch (error) {
    console.error("backup failed:", error);
  } finally {
    running = false;
  }
}

const SCHEDULER_FLAG = "__sharedBookingBackupSchedulerStarted";

// No-op without R2 vars so dev and pre-R2 prod boot normally.
export function startBackupScheduler(): void {
  const globalScope = globalThis as Record<string, unknown>;
  if (globalScope[SCHEDULER_FLAG]) return;
  globalScope[SCHEDULER_FLAG] = true;

  if (process.env.BACKUP_ENABLED === "false") {
    console.log("backup scheduler off: BACKUP_ENABLED=false");
    return;
  }
  let config: BackupConfig;
  try {
    config = loadBackupConfig();
  } catch (error) {
    console.log(`backup scheduler off: ${(error as Error).message}`);
    return;
  }
  if (!cron.validate(config.schedule)) {
    console.error(`backup scheduler off: bad BACKUP_SCHEDULE "${config.schedule}"`);
    return;
  }
  cron.schedule(config.schedule, () => void runOnce(config), { timezone: config.timezone });
  console.log(`backup scheduler on: "${config.schedule}" ${config.timezone} -> s3://${config.r2Bucket}/${config.r2Prefix}/`);
  if (config.runOnStartup) setTimeout(() => void runOnce(config), 10_000);
}
