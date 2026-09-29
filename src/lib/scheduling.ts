import cron from "node-cron";

import { services } from "@/lib/container";

/**
 * Tâches planifiées : rappels, clôture des RDV passés, pendings expirés,
 * retry du push Google.
 * Garde anti-double-démarrage : `register()` peut être appelé par plusieurs
 * workers en dev (HMR).
 */
let started = false;

export function startScheduler(): void {
  if (started) return;
  started = true;
  cron.schedule("5 * * * *", async () => {
    try {
      const { sent, completed } = await services.reminders.process();
      if (sent > 0 || completed > 0) {
        console.log(`[scheduler] rappels envoyés: ${sent}, clôturés: ${completed}`);
      }
    } catch (error) {
      console.error("[scheduler] échec", error);
    }
  });
  // Libération des créneaux impayés (toutes les 10 minutes).
  cron.schedule("*/10 * * * *", async () => {
    try {
      const released = await services.bookings.releaseExpired();
      if (released > 0) console.log(`[scheduler] pendings expirés libérés: ${released}`);
    } catch (error) {
      console.error("[scheduler] échec libération pendings", error);
    }
  });
  cron.schedule("*/15 * * * *", async () => {
    try {
      const { ok, failed } = await services.google.retryDue();
      if (ok > 0 || failed > 0) console.log(`[scheduler] google resync: ${ok} ok, ${failed} en échec`);
    } catch (error) {
      console.error("[scheduler] échec resync google", error);
    }
  });
  console.log('[scheduler] rappels ("5 * * * *"), pendings ("*/10 * * * *"), google ("*/15 * * * *")');
}
