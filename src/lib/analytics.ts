/**
 * Analytics produit (Umami) : catalogue unique des business events.
 *
 * Deux producteurs, un seul contrat :
 * - serveur : `createAnalyticsPort()` (POST `/api/send`, insensible aux
 *   adblockers) — source de vérité des faits métier ;
 * - client : `trackClientEvent()` (funnel : créneau choisi, formulaire
 *   soumis) via le snippet déjà chargé dans le layout.
 *
 * Règles :
 * - noms d'events ≤ 50 caractères (limite Umami), typés (jamais en string
 *   libre aux call sites) ;
 * - `sanitizeEventData()` applique les limites Umami (strings 500, nombres
 *   précision 4, 50 props max) + une denylist PII : un email ou un nom de
 *   patient passé par erreur ne part jamais ;
 * - le port serveur ne throw jamais (comme `safeSend` : le tracking ne doit
 *   pas faire échouer une réservation).
 */

/** Website Umami par défaut (prod). Surchargeable via `UMAMI_WEBSITE_ID`. */
export const DEFAULT_UMAMI_WEBSITE_ID = "ad8fcc2f-4830-436f-82e0-319f14727adb";

/** Instance Umami centrale (voir recette analytics dans `AGENTS.md`). */
export const DEFAULT_UMAMI_HOST = "https://stats.guillaumejacquart.com";

/**
 * Catalogue des events. Côté patient : le funnel client (`slot-selected`,
 * `submitted`) est fermé par la vérité serveur (`confirmed`, `paid`).
 * Côté praticien : 100 % serveur (dashboard derrière auth).
 */
export const ANALYTICS_EVENTS = {
  BOOKING_SLOT_SELECTED: "booking-slot-selected",
  BOOKING_SUBMITTED: "booking-submitted",
  BOOKING_CONFIRMED: "booking-confirmed",
  BOOKING_PAYMENT_STARTED: "booking-payment-started",
  BOOKING_PAID: "booking-paid",
  BOOKING_VALIDATED: "booking-validated",
  BOOKING_CANCELLED: "booking-cancelled",
  SESSION_TYPE_CREATED: "session-type-created",
} as const;

export type AnalyticsEventName =
  (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

/** Données d'event : scalaires JSON uniquement (pas d'objets imbriqués). */
export type AnalyticsData = Record<string, string | number | boolean | null | undefined>;

/** Port analytics (déclaré dans `src/lib/ports.ts`, câblé dans `container.ts`). */
export interface AnalyticsPort {
  track(event: AnalyticsEventName, data?: AnalyticsData): Promise<void>;
}

const MAX_STRING_LENGTH = 500;
const MAX_PROPERTIES = 50;

/**
 * Clés refusées (privacy) : testées en insensible à la casse, par sous-chaîne
 * pour les familles (`patientEmail`, `cancelToken`…) et en match exact pour
 * les noms courts (`name` seul, mais pas `sessionName`).
 */
const DENIED_SUBSTRINGS = ["email", "phone", "token", "secret", "password", "patient"];
const DENIED_EXACT = new Set([
  "firstname",
  "lastname",
  "name",
  "patientname",
  "notes",
  "address",
  "consent",
  "website",
]);

function deniedKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (DENIED_EXACT.has(lower)) return true;
  return DENIED_SUBSTRINGS.some((denied) => lower.includes(denied));
}

function sanitizeValue(value: string | number | boolean | null | undefined): string | number | boolean | null {
  if (value === undefined) return null;
  if (typeof value === "string") return value.slice(0, MAX_STRING_LENGTH);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Math.round(value * 10_000) / 10_000;
  }
  return value;
}

/** Nettoie les données d'event : limites Umami + strip PII. */
export function sanitizeEventData(data?: AnalyticsData): Record<string, string | number | boolean | null> {
  if (!data) return {};
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(data)) {
    if (Object.keys(clean).length >= MAX_PROPERTIES) break;
    if (value === undefined || deniedKey(key)) continue;
    clean[key] = sanitizeValue(value);
  }
  return clean;
}

/** Extrait un hostname sûr pour le payload serveur (`unknown` si invalide). */
export function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return "unknown";
  }
}

/**
 * Port Umami réel : POST `/api/send` (même website que le snippet client,
 * les events serveur apparaissent dans le même dashboard). Best-effort :
 * timeout 5 s, erreurs loguées, jamais de throw.
 */
export function createAnalyticsPort(options: {
  hostUrl: string;
  websiteId: string;
  hostname: string;
}): AnalyticsPort {
  const endpoint = `${options.hostUrl.replace(/\/$/, "")}/api/send`;
  return {
    async track(event, data) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      try {
        await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Requis par Umami : sans User-Agent la requête est rejetée.
            "User-Agent": "shared-booking",
          },
          body: JSON.stringify({
            type: "event",
            payload: {
              website: options.websiteId,
              hostname: options.hostname,
              url: "/",
              name: event,
              data: sanitizeEventData(data),
            },
          }),
          signal: controller.signal,
        });
      } catch (error) {
        console.error("[analytics] event non envoyé", { event, error });
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

declare global {
  interface Window {
    umami?: {
      track(event: string, data?: Record<string, string | number | boolean | null>): void;
    };
  }
}

/**
 * Tracking funnel côté client. No-op hors navigateur ou si le script est
 * bloqué (adblock) : la vérité métier reste côté serveur.
 */
export function trackClientEvent(event: AnalyticsEventName, data?: AnalyticsData): void {
  if (typeof window === "undefined") return;
  try {
    window.umami?.track(event, sanitizeEventData(data));
  } catch {
    // Analytics best-effort : jamais de throw vers l'UI.
  }
}
