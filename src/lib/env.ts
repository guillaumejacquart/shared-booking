import { z } from "zod";

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
});

export const isSmtpConfigured = Boolean(env.SMTP_HOST);
export const isStripeConfigured = Boolean(env.STRIPE_SECRET_KEY);
