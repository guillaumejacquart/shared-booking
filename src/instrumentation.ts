export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Dev uniquement : crée/migre une base fraîche (no-op en production).
    const { ensureDevDatabase } = await import("./db/ensure");
    ensureDevDatabase();
    const { startScheduler } = await import("./lib/scheduling");
    startScheduler();
    const { startBackupScheduler } = await import("./lib/backup");
    startBackupScheduler();
  }
}
