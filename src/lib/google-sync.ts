import { OAuth2Client } from "google-auth-library";

import * as bookingsDal from "@/dal/bookings";
import * as googleAccountsDal from "@/dal/google-accounts";
import * as practitionerGoogleDal from "@/dal/practitioner-google";
import * as practitionersDal from "@/dal/practitioners";
import * as roomsDal from "@/dal/rooms";
import type { Booking, BookingDetail } from "@/dal/types";
import { env, isGoogleConfigured } from "@/lib/env";
import type { Ports } from "@/lib/ports";

/**
 * Push outbound des réservations vers Google Agenda (par praticien).
 * - Best-effort : un échec Google ne fait jamais échouer une réservation
 *   (`google_sync_status = 'error'`, retry par le cron).
 * - Confidentialité : titre anonymisé ("Réservé") par défaut ; nom et
 *   contacts du patient uniquement si `showPatientName` (opt-in explicite).
 */

export interface GoogleEvent {
  summary: string;
  description: string;
  location: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  extendedProperties: { private: { bookingId: string; source: string } };
}

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

// --- Client REST Calendar v3 (fetch, pas de dépendance lourde) ---

export interface CalendarClient {
  insertEvent(
    calendarId: string,
    event: GoogleEvent,
  ): Promise<{ id: string }>;
  patchEvent(
    calendarId: string,
    eventId: string,
    event: GoogleEvent,
  ): Promise<void>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
  listCalendars(): Promise<{ id: string; summary: string; primary?: boolean }[]>;
}

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export function createCalendarClient(accessToken: string): CalendarClient {
  async function req(
    path: string,
    init: RequestInit,
  ): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
    const res = await fetch(`${CALENDAR_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    return {
      ok: res.ok,
      status: res.status,
      json: () => res.json() as Promise<unknown>,
    };
  }
  async function throwIfError(res: { ok: boolean; status: number; json: () => Promise<unknown> }, action: string) {
    if (res.ok) return;
    const body = await res.json().catch(() => null);
    throw new Error(`Google Calendar ${action} impossible (HTTP ${res.status}): ${JSON.stringify(body)?.slice(0, 200)}`);
  }
  return {
    async insertEvent(calendarId, event) {
      const res = await req(`/calendars/${encodeURIComponent(calendarId)}/events`, {
        method: "POST",
        body: JSON.stringify(event),
      });
      await throwIfError(res, "création");
      const body = (await res.json()) as { id: string };
      return { id: body.id };
    },
    async patchEvent(calendarId, eventId, event) {
      const res = await req(
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        { method: "PATCH", body: JSON.stringify(event) },
      );
      await throwIfError(res, "mise à jour");
    },
    async deleteEvent(calendarId, eventId) {
      const res = await req(
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        { method: "DELETE" },
      );
      // Supprimer un événement déjà supprimé côté Google = succès.
      if (res.status === 404 || res.status === 410) return;
      await throwIfError(res, "suppression");
    },
    async listCalendars() {
      const res = await req("/users/me/calendarList", { method: "GET" });
      await throwIfError(res, "liste des agendas");
      const body = (await res.json()) as {
        items?: { id: string; summary: string; primary?: boolean }[];
      };
      return body.items ?? [];
    },
  };
}

/** Access token Google frais via le refresh token stocké par Better Auth. */
export async function getGoogleAccessToken(
  userId: string,
): Promise<string | null> {
  if (!isGoogleConfigured) return null;
  const tokens = await googleAccountsDal.getGoogleTokens(userId);
  if (!tokens?.refreshToken) return null;
  const client = new OAuth2Client(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
  );
  client.setCredentials({ refresh_token: tokens.refreshToken });
  const { token } = await client.getAccessToken();
  return token ?? null;
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
  const detail: BookingDetail | null =
    await bookingsDal.getBookingById(bookingId);
  if (!detail) return;
  const { booking, practitioner: prac, office } = detail;

  const prefs = await practitionerGoogleDal.getGooglePrefs(prac.id);
  if (!prefs?.syncEnabled) {
    // Push désactivé : on ne laisse pas un statut 'pending' qui traîne.
    await bookingsDal.setGoogleSync(bookingId, { status: "none" });
    return;
  }

  const calendar = (await ports.googleCalendar?.forUser(prac.userId)) ?? null;
  if (!calendar) {
    throw new Error("Google Agenda non configuré ou compte non connecté (reconnectez votre agenda)");
  }

  // Réservation annulée : supprimer l'événement miroir s'il existe.
  if (booking.status === "cancelled") {
    if (booking.googleEventId) {
      await calendar.deleteEvent(prefs.calendarId, booking.googleEventId);
    }
    await bookingsDal.setGoogleSync(bookingId, {
      status: "ok",
      eventId: null,
      error: null,
    });
    await practitionerGoogleDal.saveGooglePrefs(prac.id, {
      lastSyncAt: new Date(),
      lastError: null,
    });
    return;
  }

  // Seuls les RDV à venir actifs sont poussés (pas les `completed` passés).
  if (booking.status !== "confirmed" && booking.status !== "pending") {
    await bookingsDal.setGoogleSync(bookingId, { status: "none" });
    return;
  }

  const rooms = await roomsDal.listRooms(office.id);
  const roomName = rooms.find((room) => room.id === booking.roomId)?.name ?? null;
  const event = buildGoogleEvent({
    booking,
    practitionerName: prac.displayName,
    officeName: office.name,
    officeAddress: office.address,
    timeZone: office.timezone,
    roomName,
    showPatientName: prefs.showPatientName,
  });

  if (booking.googleEventId) {
    await calendar.patchEvent(prefs.calendarId, booking.googleEventId, event);
  } else {
    const { id } = await calendar.insertEvent(prefs.calendarId, event);
    await bookingsDal.setGoogleSync(bookingId, {
      status: "ok",
      eventId: id,
      error: null,
    });
  }
  await bookingsDal.setGoogleSync(bookingId, { status: "ok", error: null });
  await practitionerGoogleDal.saveGooglePrefs(prac.id, {
    lastSyncAt: new Date(),
    lastError: null,
  });
}

/** Marque une réservation à synchroniser (après commit, sans attendre Google). */
export async function markGooglePending(bookingId: string): Promise<void> {
  try {
    await bookingsDal.setGoogleSync(bookingId, { status: "pending" });
  } catch {
    // La réservation reste valide même si ce marquage échoue.
  }
}

/** Retry cron : rejoue les push en `pending`/`error`. Retourne le nb de succès. */
export async function retryGoogleSyncDue(
  ports: Ports,
  limit = 20,
): Promise<{ ok: number; failed: number }> {
  if (!isGoogleConfigured) return { ok: 0, failed: 0 };
  const due = await bookingsDal.listGoogleSyncDue(limit);
  let ok = 0;
  let failed = 0;
  for (const dueBooking of due) {
    await syncBookingToGoogle(ports, dueBooking.id);
    const row = await bookingsDal.getBookingRowById(dueBooking.id);
    if (row?.googleSyncStatus === "ok") ok++;
    else failed++;
  }
  return { ok, failed };
}
