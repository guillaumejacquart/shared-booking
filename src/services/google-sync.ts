import * as bookingsDal from "@/dal/bookings";
import * as practitionerGoogleDal from "@/dal/practitioner-google";
import * as practitionersDal from "@/dal/practitioners";
import * as roomsDal from "@/dal/rooms";
import type { Booking, BookingDetail, PractitionerGoogle } from "@/dal/types";
import { isGoogleConfigured } from "@/lib/env";
import {
  friendlyGoogleErrorMessage,
  isGoogleCalendarError,
  type CalendarClient,
  type GoogleEvent,
} from "@/lib/google-calendar";
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
    await recordSyncFailure(bookingId, error);
  }
}

/**
 * Échec persisté à deux niveaux : technique sur la réservation (diagnostic),
 * convivial sur le praticien (panneau dashboard). Ne lève jamais.
 */
async function recordSyncFailure(bookingId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[google-sync] échec", { bookingId, error: message });
  await bookingsDal
    .setGoogleSync(bookingId, { status: "error", error: message })
    .catch(() => {});
  try {
    const detail = await bookingsDal.getBookingById(bookingId);
    if (!detail) return;
    const prefs = await practitionerGoogleDal.getGooglePrefs(detail.practitioner.id);
    if (!prefs) return;
    await practitionerGoogleDal.saveGooglePrefs(detail.practitioner.id, {
      lastError: friendlyGoogleErrorMessage(error),
    });
  } catch {
    // La réservation porte déjà l'erreur : rien de plus à faire.
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
    try {
      await calendar.patchEvent(prefs.calendarId, booking.googleEventId, event);
      return booking.googleEventId;
    } catch (patchError) {
      // Événement miroir supprimé à la main côté Google → on le recrée.
      if (!isGoogleCalendarError(patchError, "not-found")) throw patchError;
    }
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

/** Résultat d'un déplacement de miroirs vers un nouvel agenda. */
export interface CalendarMigration {
  /** Événements à venir recréés dans le nouvel agenda. */
  moved: number;
  /** Repush en échec (détail dans `googleSyncError` + panneau dashboard). */
  failed: number;
  /** Miroirs passés supprimés de l'ancien agenda, non recréés. */
  cleaned: number;
}

/**
 * Déplace les miroirs Google d'un praticien vers son nouvel agenda
 * (les prefs pointent déjà vers la destination) : suppression best-effort
 * dans l'ancien agenda, puis repush des RDV à venir. Les RDV passés sont
 * nettoyés de l'ancien agenda sans être recréés. Ne lève jamais.
 */
export async function moveGoogleMirrorsToCalendar(
  ports: Ports,
  practitionerId: string,
  fromCalendarId: string,
): Promise<CalendarMigration> {
  const empty: CalendarMigration = { moved: 0, failed: 0, cleaned: 0 };
  try {
    const practitioner = await practitionersDal.getPractitionerById(practitionerId);
    if (!practitioner) return empty;
    const calendar =
      (await ports.googleCalendar
        ?.forUser(practitioner.userId)
        .catch(() => null)) ?? null;
    const now = ports.clock.now();
    const mirrors = await bookingsDal.listGoogleMirrorsForPractitioner(practitionerId);
    const upcomingIds: string[] = [];
    let cleaned = 0;
    for (const mirror of mirrors) {
      await deleteMirrorFromOldCalendar(calendar, fromCalendarId, mirror.id, mirror.googleEventId);
      if (mirror.endAt < now) {
        await bookingsDal
          .setGoogleSync(mirror.id, { status: "none", eventId: null, error: null })
          .catch(() => {});
        cleaned += 1;
      } else {
        await bookingsDal
          .setGoogleSync(mirror.id, { status: "pending", eventId: null })
          .catch(() => {});
        upcomingIds.push(mirror.id);
      }
    }
    const pushed = await syncMany(ports, upcomingIds);
    return { moved: pushed.ok, failed: pushed.failed, cleaned };
  } catch (migrationError) {
    console.error("[google-sync] migration", {
      practitionerId,
      error: migrationError instanceof Error ? migrationError.message : String(migrationError),
    });
    return empty;
  }
}

/** Suppression best-effort d'un miroir dans l'ancien agenda (jamais bloquante). */
async function deleteMirrorFromOldCalendar(
  calendar: CalendarClient | null,
  fromCalendarId: string,
  bookingId: string,
  eventId: string | null,
): Promise<void> {
  if (!calendar || !eventId) return;
  try {
    await calendar.deleteEvent(fromCalendarId, eventId);
  } catch (deleteError) {
    // Ancien agenda supprimé ou événement déjà parti : on continue.
    if (isGoogleCalendarError(deleteError, "not-found")) return;
    console.error("[google-sync] suppression ancien agenda", {
      bookingId,
      error: deleteError instanceof Error ? deleteError.message : String(deleteError),
    });
  }
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
