# syntax=docker/dockerfile:1
# Image autonome Next.js (output: "standalone") — arm64 compatible (Oracle Ampere).

# ---- deps : installe les modules (better-sqlite3 = build natif) ----
FROM node:24-alpine AS deps
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder : build Next en mode standalone ----
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Aucune variable runtime n'est inlinée au build : l'image est agnostique du
# domaine et réutilisable telle quelle (auth-client cible l'origine courante).
ENV BUILD_TARGET=docker
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runner : image finale minimale ----
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Serveur autonome + assets statiques.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Migrations SQLite + runner. better-sqlite3 est déjà dans le standalone, mais
# drizzle-orm y est bundlé dans les chunks du serveur (absent de node_modules) :
# on le recopie pour que migrate.ts puisse l'importer (paquet pur JS, 0 dép).
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/src/db/migrate.ts ./src/db/migrate.ts
COPY --from=deps /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh

RUN mkdir -p /app/data && chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
