import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { db } from "@/db/client";
import { env, isGoogleConfigured } from "@/lib/env";
import { createMailer, passwordResetEmail } from "@/lib/email";
import * as schema from "@/db/schema";

/**
 * Configuration better-auth (email + mot de passe, SQLite via Drizzle).
 * MVP : pas de vérification d'email pour simplifier l'onboarding.
 *
 * Google : même client OAuth pour deux usages aux consentements séparés.
 * - SSO login/création de compte : identité seule (`openid email profile`).
 * - Push agenda praticien : les scopes Calendar sont demandés uniquement
 *   lors de la connexion agenda (profil → onglet Google), via le paramètre
 *   `scopes` de `POST /api/auth/link-social` (voir `lib/google-scopes.ts`).
 *   Better Auth fusionne les scopes (union) et Google envoie
 *   `include_granted_scopes=true` : un login SSO postérieur ne rétrécit
 *   jamais les droits agenda déjà accordés.
 * `accessType: offline` + `prompt: select_account consent` : refresh token
 * pour le push en arrière-plan, sans session navigateur.
 */
export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  // Ancien domaine gardé en alias Traefik le temps de la transition : les
  // origines restent autorisées pour que login/session fonctionnent
  // quel que soit l'hôte visité (avec ou sans www).
  trustedOrigins: [
    "https://lecabinetpartage.fr",
    "https://www.lecabinetpartage.fr",
    "https://shared-booking.guillaumejacquart.com",
  ],
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
  ...(isGoogleConfigured
    ? {
        socialProviders: {
          google: {
            clientId: env.GOOGLE_CLIENT_ID!,
            clientSecret: env.GOOGLE_CLIENT_SECRET!,
            accessType: "offline" as const,
            prompt: "select_account consent",
            scope: ["openid", "email", "profile"],
          },
        },
        // Liaison du compte Google au praticien déjà connecté (bouton
        // « Connecter » du profil). Google est un IdP de confiance : on
        // autorise les emails différents (pro vs perso).
        // `requireLocalEmailVerified: false` : les comptes email existants
        // n'ont jamais vérifié leur email (requireEmailVerification: false,
        // choix MVP). Prouver la propriété du compte Google suffit à
        // rattacher le compte local de même email — sinon le SSO échoue
        // avec `?error=account_not_linked`.
        account: {
          accountLinking: {
            enabled: true,
            trustedProviders: ["google"],
            allowDifferentEmails: true,
            requireLocalEmailVerified: false,
          },
        },
      }
    : {}),
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 jours
  },
});

export type Session = typeof auth.$Infer.Session;
