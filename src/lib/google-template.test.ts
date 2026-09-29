import { describe, expect, it } from "vitest";

import { googleCalendarTemplateUrl } from "./google-template";

describe("googleCalendarTemplateUrl", () => {
  it("construit un lien TEMPLATE avec dates UTC", () => {
    const url = googleCalendarTemplateUrl({
      title: "Séance — Camille",
      start: new Date("2026-10-02T07:00:00.000Z"),
      end: new Date("2026-10-02T08:00:00.000Z"),
      location: "Cabinet des Tilleuls",
    });
    expect(url).toContain("https://calendar.google.com/calendar/render?");
    expect(url).toContain("action=TEMPLATE");
    expect(url).toContain("dates=20261002T070000Z%2F20261002T080000Z");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("text")).toBe("Séance — Camille");
    expect(parsed.searchParams.get("location")).toBe("Cabinet des Tilleuls");
  });

  it("omet details/location quand absents", () => {
    const url = googleCalendarTemplateUrl({
      title: "RDV",
      start: new Date("2026-10-02T07:00:00.000Z"),
      end: new Date("2026-10-02T07:30:00.000Z"),
    });
    expect(url).not.toContain("details=");
    expect(url).not.toContain("location=");
  });
});
