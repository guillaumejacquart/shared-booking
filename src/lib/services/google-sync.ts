import * as bookingsDal from "@/dal/bookings";
import * as practitionerGoogleDal from "@/dal/practitioner-google";
import * as roomsDal from "@/dal/rooms";
import type { Booking, BookingDetail, PractitionerGoogle } from "@/dal/types";
import { isGoogleConfigured } from "@/lib/env";
import type { CalendarClient, GoogleEvent } from "@/lib/google-calendar";
import type { Ports } from "@/lib/ports";

/**
 * Push outbound des réservations vers Google Agenda (par praticien).
 * - Best-effort : un échec Google ne fait jamais échouer une réservation
 *   (`google_sync_status = 'error'`, retry par le cron).
 * - Confidentialité : titre anonymisé ("Réservé") par défaut ; nom et
 *   contacts du patient uniquement si `showPatientName` (opt-in explicite).
 */

export function buildGoogleEvent(args: {
  booking: Pick<
    Booking,
    | "id"
    | "sessionNameSnapshot"
    | "startAt"
    | "endAt"
    | "patientFirstName"
    | "patientLastName"
    | "patientEmail"
    | "patientPhone"
    | "notes"
  >;
  practitionerName: string;
  officeName: string;
  officeAddress: string | null;
  timeZone: string;
  roomName: string | null;
  showPatientName: boolean;
}): GoogleEvent {
  const { booking } = args;
  const patientName = `${booking.patientFirstName} ${booking.patientLastName}`;
  const summary = args.showPatientName
    ? `${booking.sessionNameSnapshot} — ${patientName}`
    : "Réservé";
  const lines = [
    `${booking.sessionNameSnapshot} — ${args.practitionerName}`,
    ...(args.roomName ? [`Salle : ${args.roomName}`] : []),
  ];
  if (args.showPatientName) {
    lines.push(`Patient : ${patientName} <${booking.patientEmail}>`);
    if (booking.patientPhone) lines.push(`Tél : ${booking.patientPhone}`);
    if (booking.notes) lines.push(`Notes : ${booking.notes}`);
  }
  return {
    summary,
    description: lines.join("\n"),
    location: args.officeAddress
      ? `${args.officeName}, ${args.officeAddress}`
      : args.officeName,
    start: { dateTime: booking.startAt.toISOString(), timeZone: args.timeZone },
    end: { dateTime: booking.endAt.toISOString(), timeZone: args.timeZone },
    extendedProperties: {
      private: { bookingId: booking.id, source: "shared-booking" },
    },
  };
}

/**
 * Synchronise une réservation (création ou mise à jour de l'événement).
 * Annulée → suppression de l'événement. Ne lève jamais (statut persisté).
 * Le client Google vient des ports (`@/lib/ports`) — fake injecté en tests.
 */
export async function syncBookingToGoogle(
  ports: Ports,
  bookingId: string,
): Promise<void> {
  try {
    await runSync(ports, bookingId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[google-sync] échec", { bookingId, error: message });
    await bookingsDal
      .setGoogleSync(bookingId, { status: "error", error: message })
      .catch(() => {});
  }
}

async function runSync(ports: Ports, bookingId: string): Promise<void> {
  const detail: BookingDetail | null = await bookingsDal.getBookingById(bookingId);
  if (!detail) return;
  const { booking, practitioner: prac } = detail;

  const prefs = await practitionerGoogleDal.getGooglePrefs(prac.id);
  // Seuls les RDV à venir actifs (ou à retirer) concernent Google.
  const pushable = ["confirmed", "pending", "cancelled"].includes(booking.status);
  if (!prefs?.syncEnabled || !pushable) {
    await bookingsDal.setGoogleSync(bookingId, { status: "none" });
    return;
  }

  const calendar = (await ports.googleCalendar?.forUser(prac.userId)) ?? null;
  if (!calendar) {
    throw new Error("Google Agenda non configuré ou compte non connecté (reconnectez votre agenda)");
  }

  if (booking.status === "cancelled") {
    if (booking.googleEventId) {
      await calendar.deleteEvent(prefs.calendarId, booking.googleEventId);
    }
    await markSynced(ports, prac.id, bookingId, null);
    return;
  }
  const eventId = await upsertEvent(calendar, detail, prefs);
  await markSynced(ports, prac.id, bookingId, eventId);
}

async function upsertEvent(
  calendar: CalendarClient,
  { booking, practitioner: prac, office }: BookingDetail,
  prefs: PractitionerGoogle,
): Promise<string> {
  const rooms = await roomsDal.listRooms(office.id);
  const event = buildGoogleEvent({
    booking,
    practitionerName: prac.displayName,
    officeName: office.name,
    officeAddress: office.address,
    timeZone: office.timezone,
    roomName: rooms.find((room) => room.id === booking.roomId)?.name ?? null,
    showPatientName: prefs.showPatientName,
  });
  if (booking.googleEventId) {
    await calendar.patchEvent(prefs.calendarId, booking.googleEventId, event);
    return booking.googleEventId;
  }
  const { id } = await calendar.insertEvent(prefs.calendarId, event);
  return id;
}

async function markSynced(
  ports: Ports,
  practitionerId: string,
  bookingId: string,
  eventId: string | null,
): Promise<void> {
  await bookingsDal.setGoogleSync(bookingId, { status: "ok", eventId, error: null });
  await practitionerGoogleDal.saveGooglePrefs(practitionerId, {
    lastSyncAt: ports.clock.now(),
    lastError: null,
  });
}

/** Rejoue la synchro d'une liste de réservations et compte les succès. */
export async function syncMany(
  ports: Ports,
  bookingIds: string[],
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  for (const bookingId of bookingIds) {
    await syncBookingToGoogle(ports, bookingId);
    const row = await bookingsDal.getBookingRowById(bookingId);
    if (row?.googleSyncStatus === "ok") ok++;
    else failed++;
  }
  return { ok, failed };
}

/** Retry cron : rejoue les push en `pending`/`error`. */
export async function retryGoogleSyncDue(
  ports: Ports,
  limit = 20,
): Promise<{ ok: number; failed: number }> {
  if (!isGoogleConfigured) return { ok: 0, failed: 0 };
  const due = await bookingsDal.listGoogleSyncDue(limit);
  return syncMany(ports, due.map((dueBooking) => dueBooking.id));
}
