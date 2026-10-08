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
 * Google (optionnel, push agenda praticien) : activé uniquement si
 * GOOGLE_CLIENT_ID/SECRET sont configurés. Scopes minimaux : `calendar.events`
 * (créer/modifier/supprimer ses propres événements) + `calendar.calendarlist.readonly`
 * (lister ses agendas : exigé par `calendarList.list` pour le sélecteur et la
 * vérification du jeton) + offline pour le refresh token (push en arrière-plan,
 * sans session navigateur).
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
            scope: [
              "openid",
              "email",
              "profile",
              "https://www.googleapis.com/auth/calendar.events",
              "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
            ],
          },
        },
        // Liaison du compte Google au praticien déjà connecté (bouton
        // « Connecter » du profil). Google est un IdP de confiance : on
        // autorise les emails différents (pro vs perso).
        account: {
          accountLinking: {
            enabled: true,
            trustedProviders: ["google"],
            allowDifferentEmails: true,
          },
        },
      }
    : {}),
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 jours
  },
});

export type Session = typeof auth.$Infer.Session;
