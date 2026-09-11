import cron from "node-cron";

import { processReminders } from "@/lib/services/reminders";
import { releaseExpiredPendings } from "@/lib/services/bookings";

/**
 * Tâches planifiées (rappels email 24h avant + clôture des RDV passés).
 * Garde anti-double-démarrage : `register()` peut être appelé par plusieurs
 * workers en dev (HMR).
 */
let started = false;

export function startScheduler(): void {
  if (started) return;
  started = true;
  cron.schedule("5 * * * *", async () => {
    try {
      const { sent, completed } = await processReminders({});
      if (sent > 0 || completed > 0) {
        console.log(`[scheduler] rappels envoyés: ${sent}, clôturés: ${completed}`);
      }
    } catch (e) {
      console.error("[scheduler] échec", e);
    }
  });
  // Libération des créneaux impayés (toutes les 10 minutes).
  cron.schedule("*/10 * * * *", async () => {
    try {
      const released = await releaseExpiredPendings({});
      if (released > 0) console.log(`[scheduler] pendings expirés libérés: ${released}`);
    } catch (e) {
      console.error("[scheduler] échec libération pendings", e);
    }
  });
  console.log('[scheduler] rappels planifiés ("5 * * * *"), pendings ("*/10 * * * *")');
}
