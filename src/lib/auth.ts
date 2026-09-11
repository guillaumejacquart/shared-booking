import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { db } from "@/db/client";
import { env } from "@/lib/env";
import { createMailer, passwordResetEmail } from "@/lib/email";
import * as schema from "@/db/schema";

/**
 * Configuration better-auth (email + mot de passe, SQLite via Drizzle).
 * MVP : pas de vérification d'email pour simplifier l'onboarding.
 */
export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    // Lien magique de reset (valable 1h) envoyé par email. Sans SMTP configuré,
    // le lien est journalisé en console (dev) au lieu d'être envoyé.
    sendResetPassword: async ({ user, url }) => {
      await createMailer()(passwordResetEmail(user.email, url));
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 jours
  },
});

export type Session = typeof auth.$Infer.Session;
