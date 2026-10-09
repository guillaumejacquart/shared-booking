/**
 * Scopes Google Agenda demandés uniquement lors de la connexion agenda
 * (profil → onglet Google, via `POST /api/auth/link-social`). Le SSO
 * login/création de compte, lui, ne demande que l'identité (`auth.ts`) :
 * même client OAuth, consentements séparés grâce à l'autorisation
 * incrémentale Google (`include_granted_scopes`) et à la fusion des scopes
 * côté Better Auth (union, jamais de rétrécissement).
 */
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
] as const;

export interface GoogleAgendaLinkBody {
  provider: "google";
  callbackURL: string;
  disableRedirect: true;
  scopes: string[];
}

/** Corps de la requête `POST /api/auth/link-social` (connexion agenda). */
export function googleAgendaLinkBody(callbackURL: string): GoogleAgendaLinkBody {
  return {
    provider: "google",
    callbackURL,
    disableRedirect: true,
    scopes: [...GOOGLE_CALENDAR_SCOPES],
  };
}
