import { OAuth2Client } from "google-auth-library";

import * as googleAccountsDal from "@/dal/google-accounts";
import { env, isGoogleConfigured } from "@/lib/env";

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
