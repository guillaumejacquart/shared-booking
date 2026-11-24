import { OAuth2Client } from "google-auth-library";

import * as googleAccountsDal from "@/dal/google-accounts";
import { env, isGoogleConfigured } from "@/lib/env";
import { zonedTimeToUtc } from "@/lib/timezone";

/**
 * Adaptateur Google Agenda : client REST v3 et jeton OAuth.
 * Aucune règle métier ici (voir `services/google-sync.ts`).
 */

export interface GoogleEvent {
  summary: string;
  description: string;
  location: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  extendedProperties: { private: { bookingId: string; source: string } };
}

/**
 * Occupation lue dans un agenda Google, déjà ramenée en instants absolus.
 * Aucune donnée de l'événement n'est conservée au-delà de ses bornes :
 * ni titre, ni participants, ni description (inbound minimal, RGPD).
 */
export interface GoogleCalendarEvent {
  startAt: Date;
  endAt: Date;
  /** Événement « journée entière » (start/end = dates sans heure). */
  allDay: boolean;
  /** `transparency: "transparent"` = marqué « disponible » par l'utilisateur. */
  transparent: boolean;
  /** Miroir créé par l'app (`extendedProperties.private.source`). */
  isMirror: boolean;
}

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
  /**
   * Événements de `[from, to)` pour le blocage des créneaux (inbound).
   * `timeZone` = fuseau du cabinet, utilisé pour dater les journées entières.
   */
  listEvents(
    calendarId: string,
    query: { from: Date; to: Date; timeZone: string },
  ): Promise<GoogleCalendarEvent[]>;
}

/** Cause d'échec d'un appel Google Agenda (diagnostic + décision de retry). */
export type GoogleCalendarErrorCode =
  | "auth" // jeton révoqué/expiré, accès refusé → reconnecter, pas de retry
  | "not-found" // agenda/événement supprimé côté Google → pas de retry
  | "rate-limited" // quota Google → retry différé
  | "unavailable"; // réseau / 5xx / requête invalide → retry selon cas

export class GoogleCalendarError extends Error {
  code: GoogleCalendarErrorCode;
  status: number | null;
  retryable: boolean;
  constructor(
    code: GoogleCalendarErrorCode,
    message: string,
    opts: { status?: number | null; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "GoogleCalendarError";
    this.code = code;
    this.status = opts.status ?? null;
    this.retryable = opts.retryable ?? false;
  }
}

export function isGoogleCalendarError(
  error: unknown,
  code?: GoogleCalendarErrorCode,
): error is GoogleCalendarError {
  return error instanceof GoogleCalendarError && (code === undefined || error.code === code);
}

/** Message affichable (FR) pour une erreur Google : jamais de JSON brut. */
export function friendlyGoogleErrorMessage(error: unknown): string {
  if (error instanceof GoogleCalendarError) {
    switch (error.code) {
      case "auth":
        return "Compte Google déconnecté ou accès révoqué — reconnectez votre agenda.";
      case "not-found":
        return "Agenda ou événement introuvable côté Google (supprimé ou agenda changé).";
      case "rate-limited":
        return "Quota Google Agenda dépassé — nouvel essai automatique dans quelques minutes.";
      case "unavailable":
        return "Google Agenda injoignable — nouvel essai automatique plus tard.";
    }
  }
  const raw = error instanceof Error ? error.message : String(error);
  return `Synchronisation Google impossible : ${raw.slice(0, 160)}`;
}

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
/** Délai max d'un appel Google : une panne ne doit jamais bloquer une réservation. */
const GOOGLE_TIMEOUT_MS = 15_000;
/** Plafond de pagination d'`events.list` (une page = 2500 événements). */
const MAX_EVENT_PAGES = 3;

/** Événement brut d'`events.list` (sous-ensemble utilisé). */
export interface RawGoogleEvent {
  status?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

/**
 * Normalise un événement brut en occupation absolue, ou `null` s'il ne peut
 * pas bloquer un créneau (annulé, sans bornes exploitables).
 * Une journée entière est datée dans le fuseau du cabinet (l'API ne fournit
 * que `YYYY-MM-DD`, sans heure).
 */
export function toGoogleCalendarEvent(
  raw: RawGoogleEvent,
  timeZone: string,
): GoogleCalendarEvent | null {
  if (raw.status === "cancelled") return null;
  const allDay = Boolean(raw.start?.date && raw.end?.date);
  const startAt = allDay
    ? zonedTimeToUtc(raw.start?.date as string, "00:00", timeZone)
    : raw.start?.dateTime
      ? new Date(raw.start.dateTime)
      : null;
  const endAt = allDay
    ? zonedTimeToUtc(raw.end?.date as string, "00:00", timeZone)
    : raw.end?.dateTime
      ? new Date(raw.end.dateTime)
      : null;
  if (!startAt || !endAt) return null;
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return null;
  if (endAt <= startAt) return null;
  return {
    startAt,
    endAt,
    allDay,
    transparent: raw.transparency === "transparent",
    isMirror:
      raw.extendedProperties?.private?.source === "shared-booking" ||
      Boolean(raw.extendedProperties?.private?.bookingId),
  };
}

const RATE_LIMIT_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "quotaExceeded",
  "dailyLimitExceeded",
  "calendarUsageLimits",
]);

export function createCalendarClient(accessToken: string): CalendarClient {
  async function req(
    path: string,
    init: RequestInit,
  ): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
    let res: Response;
    try {
      res = await fetch(`${CALENDAR_API}${path}`, {
        ...init,
        signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
    } catch (networkError) {
      throw new GoogleCalendarError(
        "unavailable",
        `Google Agenda injoignable (réseau/timeout) : ${networkError instanceof Error ? networkError.message : String(networkError)}`,
        { retryable: true },
      );
    }
    return {
      ok: res.ok,
      status: res.status,
      json: () => res.json() as Promise<unknown>,
    };
  }
  async function throwIfError(res: { ok: boolean; status: number; json: () => Promise<unknown> }, action: string) {
    if (res.ok) return;
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string; errors?: { reason?: string }[] };
    } | null;
    const reason = body?.error?.errors?.[0]?.reason ?? "";
    const detail = body?.error?.message ?? JSON.stringify(body)?.slice(0, 200) ?? "";
    const technical = `Google Calendar ${action} impossible (HTTP ${res.status}): ${detail}`;
    if (res.status === 401 || res.status === 403) {
      if (RATE_LIMIT_REASONS.has(reason)) {
        throw new GoogleCalendarError("rate-limited", technical, { status: res.status, retryable: true });
      }
      throw new GoogleCalendarError("auth", technical, { status: res.status, retryable: false });
    }
    if (res.status === 404 || res.status === 410) {
      throw new GoogleCalendarError("not-found", technical, { status: res.status, retryable: false });
    }
    if (res.status === 429 || res.status >= 500) {
      throw new GoogleCalendarError(
        res.status === 429 ? "rate-limited" : "unavailable",
        technical,
        { status: res.status, retryable: true },
      );
    }
    throw new GoogleCalendarError("unavailable", technical, { status: res.status, retryable: false });
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
    async listEvents(calendarId, query) {
      const events: GoogleCalendarEvent[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_EVENT_PAGES; page++) {
        const params = new URLSearchParams({
          timeMin: query.from.toISOString(),
          timeMax: query.to.toISOString(),
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: "2500",
          timeZone: query.timeZone,
          ...(pageToken ? { pageToken } : {}),
        });
        const res = await req(
          `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
          { method: "GET" },
        );
        await throwIfError(res, "lecture des événements");
        const body = (await res.json()) as {
          items?: RawGoogleEvent[];
          nextPageToken?: string;
        };
        for (const raw of body.items ?? []) {
          const event = toGoogleCalendarEvent(raw, query.timeZone);
          if (event) events.push(event);
        }
        pageToken = body.nextPageToken;
        if (!pageToken) break;
      }
      return events;
    },
  };
}

/**
 * Access token Google frais via le refresh token stocké par Better Auth.
 * Lève `GoogleCalendarError("auth")` si le refresh échoue (token révoqué) :
 * l'appelant doit proposer une reconnexion, pas un retry.
 */
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
  try {
    const { token } = await client.getAccessToken();
    return token ?? null;
  } catch (refreshError) {
    throw new GoogleCalendarError(
      "auth",
      `Refresh token Google rejeté : ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`,
      { retryable: false },
    );
  }
}
