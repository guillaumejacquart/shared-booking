import * as bookingsDal from "@/dal/bookings";
import * as googleAccountsDal from "@/dal/google-accounts";
import * as practitionerGoogleDal from "@/dal/practitioner-google";
import * as practitionersDal from "@/dal/practitioners";
import { isGoogleConfigured } from "@/lib/env";
import type { Ports } from "@/lib/ports";
import type { SaveGooglePrefsInput } from "@/lib/schemas/google";
import { NotFoundError, ValidationError } from "./errors";
import { retryGoogleSyncDue, syncMany } from "./google-sync";

/**
 * Service Google Agenda (préférences + état de connexion par praticien).
 * Le praticien authentifié n'agit que sur sa propre ligne.
 */

async function requirePractitioner(requesterUserId: string) {
  const prac = await practitionersDal.getPractitionerByUserId(requesterUserId);
  if (!prac) throw new NotFoundError("Profil praticien introuvable");
  return prac;
}

export interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  prefs: {
    syncEnabled: boolean;
    calendarId: string;
    showPatientName: boolean;
    lastSyncAt: string | null;
    lastError: string | null;
  } | null;
}

export async function getGoogleStatus(
  requesterUserId: string,
): Promise<GoogleStatus> {
  const prac = await requirePractitioner(requesterUserId);
  const [connected, prefs] = await Promise.all([
    googleAccountsDal.hasGoogleAccount(prac.userId),
    practitionerGoogleDal.getGooglePrefs(prac.id),
  ]);
  return {
    configured: isGoogleConfigured,
    connected,
    prefs: prefs
      ? {
          syncEnabled: prefs.syncEnabled,
          calendarId: prefs.calendarId,
          showPatientName: prefs.showPatientName,
          lastSyncAt: prefs.lastSyncAt?.toISOString() ?? null,
          lastError: prefs.lastError,
        }
      : null,
  };
}

export async function saveGooglePrefs(
  input: SaveGooglePrefsInput,
): Promise<GoogleStatus> {
  const prac = await requirePractitioner(input.requesterUserId);
  if (input.syncEnabled) {
    if (!isGoogleConfigured) {
      throw new ValidationError("Google Agenda n'est pas configuré sur ce serveur");
    }
    const connected = await googleAccountsDal.hasGoogleAccount(prac.userId);
    if (!connected) {
      throw new ValidationError("Connectez d'abord votre compte Google");
    }
  }
  await practitionerGoogleDal.saveGooglePrefs(prac.id, {
    syncEnabled: input.syncEnabled,
    calendarId: input.calendarId,
    showPatientName: input.showPatientName,
  });
  return getGoogleStatus(input.requesterUserId);
}

/** Agendas accessibles du compte Google connecté (pour le sélecteur). */
export async function listGoogleCalendars(
  ports: Ports,
  requesterUserId: string,
): Promise<{ id: string; summary: string; primary?: boolean }[]> {
  const prac = await requirePractitioner(requesterUserId);
  const calendar = (await ports.googleCalendar?.forUser(prac.userId)) ?? null;
  if (!calendar) {
    throw new ValidationError("Compte Google non connecté (reconnectez votre agenda)");
  }
  return calendar.listCalendars();
}

/** Déconnexion : supprime le compte Google lié + coupe le push. */
export async function disconnectGoogle(
  requesterUserId: string,
): Promise<void> {
  const prac = await requirePractitioner(requesterUserId);
  await googleAccountsDal.deleteGoogleAccount(prac.userId);
  await practitionerGoogleDal.saveGooglePrefs(prac.id, {
    syncEnabled: false,
    lastError: null,
  });
}

/** Resynchronise les push en échec du praticien. */
export async function resyncGoogle(
  ports: Ports,
  requesterUserId: string,
): Promise<{ ok: number; failed: number }> {
  const prac = await requirePractitioner(requesterUserId);
  const due = await bookingsDal.listGoogleSyncDueForPractitioner(prac.id);
  return syncMany(ports, due.map((dueBooking) => dueBooking.id));
}

/** Surface du service Google (utilisée par les routes via le container). */
export interface GoogleService {
  getGoogleStatus: typeof getGoogleStatus;
  saveGooglePrefs: typeof saveGooglePrefs;
  listGoogleCalendars(requesterUserId: string): ReturnType<typeof listGoogleCalendars>;
  disconnectGoogle: typeof disconnectGoogle;
  resyncGoogle(requesterUserId: string): ReturnType<typeof resyncGoogle>;
  retryDue(): ReturnType<typeof retryGoogleSyncDue>;
}

export function createGoogleService(ports: Ports): GoogleService {
  return {
    getGoogleStatus,
    saveGooglePrefs,
    listGoogleCalendars: (requesterUserId) => listGoogleCalendars(ports, requesterUserId),
    disconnectGoogle,
    resyncGoogle: (requesterUserId) => resyncGoogle(ports, requesterUserId),
    retryDue: () => retryGoogleSyncDue(ports),
  };
}
