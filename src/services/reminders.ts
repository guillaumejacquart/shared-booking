import * as bookingsDal from "@/dal/bookings";
import * as officesDal from "@/dal/offices";
import * as practitionersDal from "@/dal/practitioners";
import { reminderEmail } from "@/lib/email";
import type { Ports } from "@/lib/ports";
import { mailModel } from "./bookings/shared";

/**
 * Service de rappels + clôture (exécuté par le cron horaire).
 * - Envoie le rappel quand `startAt - reminderHoursBefore <= now` (une seule
 *   fois grâce à `reminderSentAt`).
 * - Bascule les RDV passés en `completed`.
 */
export async function processReminders(ports: Ports): Promise<{ sent: number; completed: number }> {
  const now = ports.clock.now();
  const send = ports.sendEmail;

  const candidates = await bookingsDal.listRemindersDue(now);
  // Charge groupé : une seule vague de requêtes au lieu d'une par candidat.
  const officeIds = [...new Set(candidates.map((booking) => booking.officeId))];
  const pracIds = [...new Set(candidates.map((booking) => booking.practitionerId))];
  const [offices, pracs] = await Promise.all([
    Promise.all(officeIds.map((id) => officesDal.getOfficeById(id))),
    Promise.all(pracIds.map((id) => practitionersDal.getPractitionerById(id))),
  ]);
  const officeById = new Map<string, NonNullable<(typeof offices)[number]>>();
  for (const office of offices) {
    if (office) officeById.set(office.id, office);
  }
  const pracById = new Map<string, NonNullable<(typeof pracs)[number]>>();
  for (const prac of pracs) {
    if (prac) pracById.set(prac.id, prac);
  }

  let sent = 0;
  for (const booking of candidates) {
    const office = officeById.get(booking.officeId);
    const prac = pracById.get(booking.practitionerId);
    if (!office || !prac) continue;
    const dueAt = booking.startAt.getTime() - office.reminderHoursBefore * 3_600_000;
    if (dueAt > now.getTime()) continue;
    try {
      await send(
        reminderEmail(booking.patientEmail, {
          ...mailModel(booking, { practitioner: prac, office }, { now }),
          manageUrl: "",
        }),
      );
      await bookingsDal.markReminderSent(booking.id, now);
      sent++;
    } catch (error) {
      // Un envoi raté ne bloque pas les autres (compté uniquement si succès).
      console.error("[reminders] envoi impossible", { bookingId: booking.id, error });
    }
  }

  const completed = await bookingsDal.completePastBookings(now);
  return { sent, completed };
}

/** Surface du service rappels (utilisée par le cron via le container). */
export interface RemindersService {
  process(): ReturnType<typeof processReminders>;
}

export function createRemindersService(ports: Ports): RemindersService {
  return {
    process: () => processReminders(ports),
  };
}
