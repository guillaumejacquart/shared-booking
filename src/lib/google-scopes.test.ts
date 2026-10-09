import { describe, expect, it } from "vitest";

import { GOOGLE_CALENDAR_SCOPES, googleAgendaLinkBody } from "./google-scopes";

describe("scopes Google", () => {
  it("ne contient que des scopes agenda (jamais openid/email/profile, réservés au SSO)", () => {
    expect([...GOOGLE_CALENDAR_SCOPES]).toEqual([
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    ]);
  });

  it("construit le corps link-social avec les scopes agenda", () => {
    expect(googleAgendaLinkBody("/dashboard/profil?tab=google")).toEqual({
      provider: "google",
      callbackURL: "/dashboard/profil?tab=google",
      disableRedirect: true,
      scopes: [
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      ],
    });
  });
});
