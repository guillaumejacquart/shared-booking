import * as bookingsDal from "@/dal/bookings";
import * as googleAccountsDal from "@/dal/google-accounts";
import * as practitionerGoogleDal from "@/dal/practitioner-google";
import * as practitionersDal from "@/dal/practitioners";
import { isGoogleConfigured } from "@/lib/env";
import { friendlyGoogleErrorMessage, isGoogleCalendarError } from "@/lib/google-calendar";
import type { Ports } from "@/lib/ports";
import type { SaveGooglePrefsInput } from "@/lib/schemas/google";
import { NotFoundError, ValidationError } from "./errors";
import {
  moveGoogleMirrorsToCalendar,
  retryGoogleSyncDue,
  syncMany,
  type CalendarMigration,
} from "./google-sync";

/**
 * Service Google Agenda (préférences + état de connexion par praticien).
 * Le praticien authentifié n'agit que sur sa propre ligne.
 */

async function requirePractitioner(requesterUserId: string) {
  const prac = await practitionersDal.getPractitionerByUserId(requesterUserId);
  if (!prac) throw new NotFoundError("Profil praticien introuvable");
  return prac;
}

export interface GoogleSyncIssue {
  bookingId: string;
  sessionName: string;
  startAt: string;
  bookingStatus: string;
  error: string | null;
}

export interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  /**
   * Vérification live du jeton (un appel Google) : false = accès rejeté
   * (reconnecter), null = non connecté ou vérification impossible
   * (panne transitoire — on ne conclut pas).
   */
  tokenValid: boolean | null;
  prefs: {
    syncEnabled: boolean;
    calendarId: string;
    showPatientName: boolean;
    lastSyncAt: string | null;
    lastError: string | null;
  } | null;
  sync: { ok: number; pending: number; error: number };
  recentErrors: GoogleSyncIssue[];
}

export async function getGoogleStatus(
  ports: Ports,
  requesterUserId: string,
): Promise<GoogleStatus> {
  const prac = await requirePractitioner(requesterUserId);
  const [connected, prefs, overview] = await Promise.all([
    googleAccountsDal.hasGoogleAccount(prac.userId),
    practitionerGoogleDal.getGooglePrefs(prac.id),
    bookingsDal.getGoogleSyncOverviewForPractitioner(prac.id),
  ]);
  const tokenValid = connected ? await checkGoogleToken(ports, prac.userId) : null;
  return {
    configured: isGoogleConfigured,
    connected,
    tokenValid,
    prefs: prefs
      ? {
          syncEnabled: prefs.syncEnabled,
          calendarId: prefs.calendarId,
          showPatientName: prefs.showPatientName,
          lastSyncAt: prefs.lastSyncAt?.toISOString() ?? null,
          lastError: prefs.lastError,
        }
      : null,
    sync: overview.counts,
    recentErrors: overview.recentErrors.map((issue) => ({
      bookingId: issue.bookingId,
      sessionName: issue.sessionName,
      startAt: issue.startAt.toISOString(),
      bookingStatus: issue.bookingStatus,
      error: issue.error,
    })),
  };
}

/** Ping léger (liste des agendas) : seul un refus d'auth conclut à l'invalidité. */
async function checkGoogleToken(ports: Ports, userId: string): Promise<boolean | null> {
  try {
    const calendar = (await ports.googleCalendar?.forUser(userId)) ?? null;
    if (!calendar) return false;
    await calendar.listCalendars();
    return true;
  } catch (tokenError) {
    if (isGoogleCalendarError(tokenError, "auth")) return false;
    return null;
  }
}

export interface GooglePrefsResult {
  status: GoogleStatus;
  /** Déplacement des miroirs, uniquement lors d'un changement d'agenda. */
  migration: CalendarMigration | null;
}

export async function saveGooglePrefs(
  ports: Ports,
  input: SaveGooglePrefsInput,
): Promise<GooglePrefsResult> {
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
  const previous = await practitionerGoogleDal.getGooglePrefs(prac.id);
  await practitionerGoogleDal.saveGooglePrefs(prac.id, {
    syncEnabled: input.syncEnabled,
    calendarId: input.calendarId,
    showPatientName: input.showPatientName,
  });
  // Changement d'agenda de destination : les miroirs de l'ancien agenda
  // deviennent orphelins → déplacement complet (suppression + repush).
  const agendaChanged =
    input.syncEnabled === true &&
    typeof input.calendarId === "string" &&
    input.calendarId.length > 0 &&
    previous !== null &&
    previous.calendarId !== input.calendarId;
  let migration: CalendarMigration | null = null;
  if (agendaChanged && previous) {
    migration = await moveGoogleMirrorsToCalendar(ports, prac.id, previous.calendarId);
  }
  return { status: await getGoogleStatus(ports, input.requesterUserId), migration };
}

/** Agendas accessibles du compte Google connecté (pour le sélecteur). */
export async function listGoogleCalendars(
  ports: Ports,
  requesterUserId: string,
): Promise<{ id: string; summary: string; primary?: boolean }[]> {
  const prac = await requirePractitioner(requesterUserId);
  try {
    const calendar = (await ports.googleCalendar?.forUser(prac.userId)) ?? null;
    if (!calendar) {
      throw new ValidationError("Compte Google non connecté (reconnectez votre agenda)");
    }
    return await calendar.listCalendars();
  } catch (listError) {
    if (isGoogleCalendarError(listError)) {
      throw new ValidationError(friendlyGoogleErrorMessage(listError));
    }
    throw listError;
  }
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
  getGoogleStatus(requesterUserId: string): ReturnType<typeof getGoogleStatus>;
  saveGooglePrefs(input: SaveGooglePrefsInput): ReturnType<typeof saveGooglePrefs>;
  listGoogleCalendars(requesterUserId: string): ReturnType<typeof listGoogleCalendars>;
  disconnectGoogle: typeof disconnectGoogle;
  resyncGoogle(requesterUserId: string): ReturnType<typeof resyncGoogle>;
  retryDue(): ReturnType<typeof retryGoogleSyncDue>;
}

export function createGoogleService(ports: Ports): GoogleService {
  return {
    getGoogleStatus: (requesterUserId) => getGoogleStatus(ports, requesterUserId),
    saveGooglePrefs: (input) => saveGooglePrefs(ports, input),
    listGoogleCalendars: (requesterUserId) => listGoogleCalendars(ports, requesterUserId),
    disconnectGoogle,
    resyncGoogle: (requesterUserId) => resyncGoogle(ports, requesterUserId),
    retryDue: () => retryGoogleSyncDue(ports),
  };
}
