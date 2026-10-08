import { z } from "zod";

import { DEFAULT_UMAMI_HOST, DEFAULT_UMAMI_WEBSITE_ID } from "@/lib/analytics";

/** Validation centralisée des variables d'environnement. */
const envSchema = z.object({
  SQLITE_PATH: z.string().default("./local.db"),
  BETTER_AUTH_SECRET: z
    .string()
    .min(16)
    .default("dev-secret-change-me-please-32chars-min"),
  BETTER_AUTH_URL: z.string().default("http://localhost:3000"),

  // --- SMTP (envoi d'emails) — tout est optionnel : sans SMTP_HOST, l'envoi
  // est désactivé et on se contente de journaliser.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default("noreply@localhost"),

  // --- Stripe (paiement en ligne) — optionnel : sans STRIPE_SECRET_KEY,
  // les types de séance payants sont rejetés à la réservation.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // Commission plateforme prélevée via Connect (destination charges).
  // 0 = pas de commission (reversement intégral au praticien).
  STRIPE_APPLICATION_FEE_CENTS: z.coerce.number().int().min(0).default(0),
  // Abonnement SaaS (1 par cabinet) : prix mensuel Stripe (`price_...`).
  // Sans prix, la facturation est désactivée (bandeau masqué).
  STRIPE_SUBSCRIPTION_PRICE_ID: z.string().optional(),
  // Feature flag abonnement : à "true", le bandeau + l'onglet Abonnement
  // sont visibles et le checkout/portal Stripe actifs. À "false" (défaut),
  // tout le monde utilise le service sans restriction ni paiement.
  SUBSCRIPTION_ENABLED: z.enum(["true", "false"]).optional().default("false"),

  // --- Google (push agenda praticien) — optionnel : sans GOOGLE_CLIENT_*,
  // la connexion Google est désactivée et les réservations restent locales.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // --- Umami (business events) — tout est optionnel : les défauts pointent
  // vers l'instance centrale ; surchargeable (ex. website staging séparé).
  UMAMI_HOST: z.string().default(DEFAULT_UMAMI_HOST),
  UMAMI_WEBSITE_ID: z.string().default(DEFAULT_UMAMI_WEBSITE_ID),
});

export const env = envSchema.parse({
  SQLITE_PATH: process.env.SQLITE_PATH,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  EMAIL_FROM: process.env.EMAIL_FROM,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  STRIPE_APPLICATION_FEE_CENTS: process.env.STRIPE_APPLICATION_FEE_CENTS,
  STRIPE_SUBSCRIPTION_PRICE_ID: process.env.STRIPE_SUBSCRIPTION_PRICE_ID,
  SUBSCRIPTION_ENABLED: process.env.SUBSCRIPTION_ENABLED,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  UMAMI_HOST: process.env.UMAMI_HOST,
  UMAMI_WEBSITE_ID: process.env.UMAMI_WEBSITE_ID,
});

export const isSmtpConfigured = Boolean(env.SMTP_HOST);
export const isStripeConfigured = Boolean(env.STRIPE_SECRET_KEY);
export const isSubscriptionEnabled = env.SUBSCRIPTION_ENABLED === "true";
export const isGoogleConfigured = Boolean(
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
);
