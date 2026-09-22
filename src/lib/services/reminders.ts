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
  now?: Date;
  sendEmail?: SendEmail;
}): Promise<{ sent: number; completed: number }> {
  const now = deps.now ?? new Date();
  const send = deps.sendEmail ?? createMailer();

  const candidates = await bookingsDal.listRemindersDue(now);
  // Charge groupé : une seule vague de requêtes au lieu d'une par candidat.
  const officeIds = [...new Set(candidates.map((b) => b.officeId))];
  const pracIds = [...new Set(candidates.map((b) => b.practitionerId))];
  const [offices, pracs] = await Promise.all([
    Promise.all(officeIds.map((id) => officesDal.getOfficeById(id))),
    Promise.all(pracIds.map((id) => practitionersDal.getPractitionerById(id))),
  ]);
  const officeById = new Map(offices.filter((o) => o).map((o) => [o!.id, o!]));
  const pracById = new Map(pracs.filter((p) => p).map((p) => [p!.id, p!]));

  let sent = 0;
  for (const b of candidates) {
    const office = officeById.get(b.officeId);
    const prac = pracById.get(b.practitionerId);
    if (!office || !prac) continue;
    const dueAt = b.startAt.getTime() - office.reminderHoursBefore * 3_600_000;
    if (dueAt > now.getTime()) continue;
    try {
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
      await bookingsDal.markReminderSent(b.id, now);
      sent++;
    } catch (e) {
      // Un envoi raté ne bloque pas les autres (compté uniquement si succès).
      console.error("[reminders] envoi impossible", { bookingId: b.id, error: e });
    }
  }

  const completed = await bookingsDal.completePastBookings(now);
  return { sent, completed };
}
