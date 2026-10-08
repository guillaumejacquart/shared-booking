import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ANALYTICS_EVENTS,
  createAnalyticsPort,
  hostnameOf,
  sanitizeEventData,
} from "@/lib/analytics";

describe("sanitizeEventData", () => {
  it("garde les dimensions métier, jette la PII", () => {
    expect(
      sanitizeEventData({
        practitionerSlug: "alice",
        sessionName: "Séance 60min",
        durationMin: 60,
        requiresValidation: false,
        patientEmail: "jean@example.com",
        patientFirstName: "Jean",
        cancelToken: "secret",
        notes: "mal de dos",
        website: "bot",
      }),
    ).toEqual({
      practitionerSlug: "alice",
      sessionName: "Séance 60min",
      durationMin: 60,
      requiresValidation: false,
    });
  });

  it("tronque les strings, arrondit les nombres, ignore l'infini", () => {
    const cleaned = sanitizeEventData({
      long: "x".repeat(600),
      price: 19.99999,
      infinite: Number.POSITIVE_INFINITY,
      missing: undefined,
      kept: null,
    });
    expect(cleaned.long).toHaveLength(500);
    expect(cleaned.price).toBe(20);
    expect(cleaned.infinite).toBeNull();
    expect(cleaned).not.toHaveProperty("missing");
    expect(cleaned.kept).toBeNull();
  });

  it("plafonne à 50 propriétés", () => {
    const data: Record<string, number> = {};
    for (let index = 0; index < 60; index++) data[`prop${index}`] = index;
    expect(Object.keys(sanitizeEventData(data))).toHaveLength(50);
  });
});

describe("hostnameOf", () => {
  it("extrait le hostname, unknown si invalide", () => {
    expect(hostnameOf("https://cabinet.example.com/")).toBe("cabinet.example.com");
    expect(hostnameOf("not-a-url")).toBe("unknown");
  });
});

describe("createAnalyticsPort", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POST /api/send avec User-Agent, website et data nettoyée", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response("{}", { status: 200 });
      },
    );
    const analytics = createAnalyticsPort({
      hostUrl: "https://stats.example.com/",
      websiteId: "website-id",
      hostname: "cabinet.example.com",
    });
    await analytics.track(ANALYTICS_EVENTS.BOOKING_CONFIRMED, {
      practitionerSlug: "alice",
      patientEmail: "jean@example.com",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://stats.example.com/api/send");
    expect(calls[0].init.headers).toMatchObject({
      "Content-Type": "application/json",
      "User-Agent": "shared-booking",
    });
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      type: "event",
      payload: {
        website: "website-id",
        hostname: "cabinet.example.com",
        url: "/",
        name: "booking-confirmed",
        data: { practitionerSlug: "alice" },
      },
    });
  });

  it("ne throw jamais quand le réseau échoue", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("réseau coupé");
    });
    const analytics = createAnalyticsPort({
      hostUrl: "https://stats.example.com",
      websiteId: "website-id",
      hostname: "cabinet.example.com",
    });
    await expect(
      analytics.track(ANALYTICS_EVENTS.BOOKING_PAID, { revenue: 60 }),
    ).resolves.toBeUndefined();
  });
});
