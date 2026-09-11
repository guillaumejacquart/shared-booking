import type { Db } from "@/dal/types";
import * as bookingsDal from "@/dal/bookings";
import * as officesDal from "@/dal/offices";
import * as practitionersDal from "@/dal/practitioners";
import {
  createMailer,
  reminderEmail,
  type SendEmail,
} from "@/lib/email";

/**
 * Service de rappels + clôture (exécuté par le cron horaire).
 * - Envoie le rappel quand `startAt - reminderHoursBefore <= now` (une seule
 *   fois grâce à `reminderSentAt`).
 * - Bascule les RDV passés en `completed`.
 */
export async function processReminders(deps: {
  db: Db;
  now?: Date;
  sendEmail?: SendEmail;
}): Promise<{ sent: number; completed: number }> {
  const now = deps.now ?? new Date();
  const send = deps.sendEmail ?? createMailer();

  const candidates = await bookingsDal.listRemindersDue(deps.db, now);
  let sent = 0;
  for (const b of candidates) {
    const office = await officesDal.getOfficeById(deps.db, b.officeId);
    const prac = await practitionersDal.getPractitionerById(deps.db, b.practitionerId);
    if (!office || !prac) continue;
    const dueAt = b.startAt.getTime() - office.reminderHoursBefore * 3_600_000;
    if (dueAt > now.getTime()) continue;
    await send(
      reminderEmail(b.patientEmail, {
        practitionerName: prac.displayName,
        sessionName: b.sessionNameSnapshot,
        start: b.startAt,
        timeZone: office.timezone,
        officeName: office.name,
        officeAddress: office.address,
        manageUrl: "",
      }),
    );
    await bookingsDal.markReminderSent(deps.db, b.id, now);
    sent++;
  }

  const completed = await bookingsDal.completePastBookings(deps.db, now);
  return { sent, completed };
}
