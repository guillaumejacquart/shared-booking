import * as practitionerGoogleDal from "@/dal/practitioner-google";
import * as practitionersDal from "@/dal/practitioners";
import { busyIntervals, mergeIntervals, type BusyInterval } from "@/lib/google-busy";
import { friendlyGoogleErrorMessage } from "@/lib/google-calendar";
import type { Ports } from "@/lib/ports";
import { dateStrInTz, zonedTimeToUtc } from "@/lib/timezone";

/**
 * Inbound Google Agenda : occupations à bloquer dans la grille de créneaux.
 *
 * - Lecture seule, best-effort : une panne Google laisse les créneaux ouverts
 *   (fail-open) et n'empêche jamais d'afficher la page publique.
 * - Confidentialité : seules les bornes des événements sont lues, jamais les
 *   titres ni les participants ; rien n'est persisté en base.
 * - Cache mémoire 60 s par (praticien, agendas, fenêtre) : la page publique
 *   interroge souvent les mêmes jours, on évite un appel Google par requête.
 * - Le port `calendar.events` déjà demandé à la connexion suffit
 *   (`events.list`) : aucune réautorisation nécessaire.
 */

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 500;
/** Écriture de `lastBusyAt` au plus une fois toutes les 5 min. */
const LAST_BUSY_THROTTLE_MS = 5 * 60_000;

interface CacheEntry {
  expiresAt: number;
  intervals: BusyInterval[];
}

const cache = new Map<string, CacheEntry>();

/** Vide le cache (tests, ou après un changement de préférences). */
export function clearGoogleBusyCache(): void {
  cache.clear();
}

export interface GoogleBusyInput {
  practitionerId: string;
  from: Date;
  to: Date;
  timezone: string;
}

/**
 * Occupations Google du praticien sur `[from, to)`, prêtes à être fusionnées
 * dans `practitionerBusy`. Retourne `[]` si le blocage est désactivé, Google
 * non configuré/non connecté, ou en cas d'échec (jamais d'exception).
 */
export async function getGoogleBusy(
  ports: Ports,
  input: GoogleBusyInput,
): Promise<BusyInterval[]> {
  // Pas de compte Google connecté (`forUser` → null) = aucun blocage : la
  // lecture est déjà gâtée par `blockEnabled` et le port, pas besoin de
  // vérifier les clés OAuth ici.
  if (!ports.googleCalendar) return [];
  const prefs = await practitionerGoogleDal.getGooglePrefs(input.practitionerId);
  if (!prefs?.blockEnabled) return [];
  const practitioner = await practitionersDal.getPractitionerById(input.practitionerId);
  if (!practitioner) return [];

  const calendarIds =
    prefs.blockCalendarIds.length > 0 ? prefs.blockCalendarIds : ["primary"];
  // Fenêtre élargie au jour entier : la même entrée de cache sert toutes les
  // requêtes d'une journée (le `from` public avance avec l'heure courante).
  const dayStart = zonedTimeToUtc(
    dateStrInTz(input.from, input.timezone),
    "00:00",
    input.timezone,
  );
  const days = Math.max(
    1,
    Math.ceil((input.to.getTime() - input.from.getTime()) / 86_400_000),
  );
  const to = new Date(dayStart.getTime() + (days + 1) * 86_400_000);
  const key = [
    practitioner.userId,
    [...calendarIds].sort().join(","),
    prefs.blockAllDay ? "all-day" : "timed",
    dayStart.toISOString(),
    String(days),
  ].join("|");

  const now = ports.clock.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now.getTime()) return cached.intervals;

  try {
    const calendar = await ports.googleCalendar.forUser(practitioner.userId);
    if (!calendar) return [];
    const events = (
      await Promise.all(
        calendarIds.map((calendarId) =>
          calendar.listEvents(calendarId, { from: dayStart, to, timeZone: input.timezone }),
        ),
      )
    ).flat();
    const intervals = mergeIntervals(
      busyIntervals(events, { includeAllDay: prefs.blockAllDay }),
    );
    remember(key, intervals, now);
    await markLastBusy(prefs.lastBusyAt, ports, input.practitionerId, now);
    return intervals;
  } catch (error) {
    // Fail-open : l'agenda Google est une contrainte de confort, pas une
    // dépendance critique (même philosophie que le push best-effort).
    console.error("[google-busy] lecture impossible", {
      practitionerId: input.practitionerId,
      error: friendlyGoogleErrorMessage(error),
    });
    return [];
  }
}

function remember(
  key: string,
  intervals: BusyInterval[],
  now: Date,
): void {
  if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
  cache.set(key, { expiresAt: now.getTime() + CACHE_TTL_MS, intervals });
}

async function markLastBusy(
  lastBusyAt: Date | null,
  ports: Ports,
  practitionerId: string,
  now: Date,
): Promise<void> {
  if (lastBusyAt && now.getTime() - lastBusyAt.getTime() < LAST_BUSY_THROTTLE_MS) return;
  await practitionerGoogleDal
    .saveGooglePrefs(practitionerId, { lastBusyAt: now })
    .catch(() => {});
}
