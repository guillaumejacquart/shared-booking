"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Client better-auth pour les composants React (signIn / signUp / signOut / useSession).
 * Sans `baseURL`, le client cible l'origine courante (window.location.origin) :
 * l'image Docker reste agnostique du domaine (aucune variable inlinée au build).
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
