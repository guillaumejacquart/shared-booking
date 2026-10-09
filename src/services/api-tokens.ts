import { createHash, randomBytes } from "node:crypto";

import * as apiTokensDal from "@/dal/api-tokens";
import * as practitionersDal from "@/dal/practitioners";
import type { ApiToken, Practitioner } from "@/dal/types";
import type { Ports } from "@/lib/ports";
import {
  API_TOKEN_PREFIX,
  type ApiScope,
  type CreateApiTokenInput,
  type RevokeApiTokenInput,
} from "@/lib/schemas/api-tokens";
import { NotFoundError, ValidationError } from "./errors";

/**
 * Clés d'API personnelles (PAT) : un praticien génère des secrets
 * `cbpat_…` pour brancher des outils externes (autres agendas, écrans…).
 * Seul le hash SHA-256 persiste ; le clair n'est rendu qu'à la création.
 */

export interface ApiTokenMeta {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  expired: boolean;
}

export interface CreatedApiToken extends ApiTokenMeta {
  /** Secret en clair : affiché une seule fois, jamais relisible. */
  token: string;
}

export interface ResolvedApiToken {
  token: ApiToken;
  scopes: ApiScope[];
  practitioner: Practitioner;
}

export function hashApiToken(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

function parseScopes(row: ApiToken): ApiScope[] {
  try {
    const parsed: unknown = JSON.parse(row.scopes);
    if (!Array.isArray(parsed)) return ["read"];
    return parsed.filter((scope) => scope === "read" || scope === "write");
  } catch {
    return ["read"];
  }
}

function toMeta(row: ApiToken, now: Date): ApiTokenMeta {
  return {
    id: row.id,
    name: row.name,
    prefix: row.tokenPrefix,
    scopes: parseScopes(row),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    expired: row.expiresAt != null && row.expiresAt.getTime() <= now.getTime(),
  };
}

async function requirePractitioner(requesterUserId: string): Promise<Practitioner> {
  const practitioner =
    await practitionersDal.getPractitionerByUserId(requesterUserId);
  if (!practitioner || !practitioner.active) {
    throw new NotFoundError("Profil praticien introuvable");
  }
  return practitioner;
}

export function hasApiScope(scopes: ApiScope[], required: ApiScope): boolean {
  if (required === "read") return scopes.includes("read") || scopes.includes("write");
  return scopes.includes("write");
}

export async function listApiTokens(
  ports: Ports,
  requesterUserId: string,
): Promise<ApiTokenMeta[]> {
  const practitioner = await requirePractitioner(requesterUserId);
  const rows = await apiTokensDal.listApiTokensByPractitioner(practitioner.id);
  return rows.map((row) => toMeta(row, ports.clock.now()));
}

export async function createApiToken(
  ports: Ports,
  input: CreateApiTokenInput,
): Promise<CreatedApiToken> {
  const practitioner = await requirePractitioner(input.requesterUserId);
  const now = ports.clock.now();
  let expiresAt: Date | null = null;
  if (input.expiresAt) {
    expiresAt = new Date(input.expiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
      throw new ValidationError("La date d'expiration doit être dans le futur");
    }
  }
  const secret = randomBytes(32).toString("base64url");
  const scopes: ApiScope[] = input.write ? ["read", "write"] : ["read"];
  const row = await apiTokensDal.insertApiToken({
    practitionerId: practitioner.id,
    name: input.name,
    tokenHash: hashApiToken(API_TOKEN_PREFIX + secret),
    tokenPrefix: secret.slice(0, 8),
    scopes,
    createdByUserId: input.requesterUserId,
    expiresAt,
  });
  return { ...toMeta(row, now), token: API_TOKEN_PREFIX + secret };
}

export async function revokeApiToken(
  ports: Ports,
  input: RevokeApiTokenInput,
): Promise<{ id: string }> {
  const practitioner = await requirePractitioner(input.requesterUserId);
  const revoked = await apiTokensDal.revokeApiToken(
    input.tokenId,
    practitioner.id,
    ports.clock.now(),
  );
  if (!revoked) throw new NotFoundError("Clé introuvable");
  return { id: input.tokenId };
}

/**
 * Résolution d'un secret présenté (API v1) : null si inconnu, révoqué,
 * expiré ou rattaché à un praticien désactivé. Ne lève jamais pour un
 * secret invalide (l'appelant répond 401).
 */
export async function resolveApiToken(
  ports: Ports,
  plain: string,
): Promise<ResolvedApiToken | null> {
  if (!plain.startsWith(API_TOKEN_PREFIX) || plain.length < API_TOKEN_PREFIX.length + 16) {
    return null;
  }
  const row = await apiTokensDal.findApiTokenByHash(hashApiToken(plain));
  if (!row || row.revokedAt) return null;
  const now = ports.clock.now();
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return null;
  const practitioner = await practitionersDal.getPractitionerById(row.practitionerId);
  if (!practitioner || !practitioner.active) return null;
  try {
    await apiTokensDal.touchApiTokenLastUsed(row.id, now);
  } catch {
    // Usage indicatif seul : un échec ne bloque pas l'appel.
  }
  return { token: row, scopes: parseScopes(row), practitioner };
}

export interface ApiTokensService {
  list(input: { requesterUserId: string }): Promise<ApiTokenMeta[]>;
  create(input: CreateApiTokenInput): Promise<CreatedApiToken>;
  revoke(input: RevokeApiTokenInput): Promise<{ id: string }>;
  resolve(plain: string): Promise<ResolvedApiToken | null>;
}

export function createApiTokensService(ports: Ports): ApiTokensService {
  return {
    list: (input) => listApiTokens(ports, input.requesterUserId),
    create: (input) => createApiToken(ports, input),
    revoke: (input) => revokeApiToken(ports, input),
    resolve: (plain) => resolveApiToken(ports, plain),
  };
}
