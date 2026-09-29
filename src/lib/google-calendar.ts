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
