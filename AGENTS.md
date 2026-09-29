<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Règles de code

Complément aux règles de `~/Sources/perso/Claude.md` (3 couches, TypeScript strict).
La plupart sont vérifiées par ESLint (`npm run lint`) : garder lint + `npm run typecheck`
+ `npm test` verts.

### Injection de dépendances (ports + container)

- Tout ce que les services empruntent au monde extérieur est un **port** déclaré dans
  `src/lib/ports.ts` : `clock` (le temps est une dépendance externe, pas un paramètre
  de contexte), `sendEmail`, `stripeClient`, `googleCalendar`.
- Le câblage réel vit en **un seul endroit** : `src/lib/container.ts` (composition root).
  Routes et cron n'importent que `services` — `services.bookings.create(input)` — et ne
  passent jamais de `deps`/`{}`. Aucun `new Stripe(...)`, `createMailer()` ou
  `new Date()` ailleurs que dans le container.
- Tests : `testPorts({ clock: fixedClock(NOW), sendEmail: capture, ... })`
  (`src/test/ports.ts`) pour les fonctions brutes, ou `makeServices({...})` pour la
  surface groupée.
- Nouveau service : factory `createXService(ports)` + interface `XService`, enregistrée
  dans `container.ts`. Pas de type `deps` ad hoc par service (voir l'historique
  `Deps`/`TeamDeps`/`SyncDeps`…).

### Données dérivées : une seule source

- Tout artefact dérivé (titres, lieux, URLs, dates formatées) est construit dans **un
  seul builder** ; les call sites n'assemblent jamais un payload pièce par pièce. Exemple
  canonique : `mailModel` dérivant le modèle textuel, l'ICS et le lien Google Agenda de
  la même description d'événement.
- Les valeurs toujours produites ensemble voyagent ensemble : un objet typé unique, pas
  une liste d'arguments positionnels (3 max).
- Ne jamais réimplémenter un mapper existant : l'étendre ou l'appeler.

### Noms

- Identifiants explicites, ≥ 2 caractères (lint `id-length`) : `b`, `m`, `e`, `r`, `p`…
  sont interdits au cœur métier (`src/lib`, `src/dal`) — préférer `booking`, `model`,
  `error`, `room`, `prac`.
- Exception documentée : `t()` pour l'i18n.
- Sur l'UI existante la règle est encore en **warning** (dette à purger) : tout nouveau
  code la respecte d'office, quel que soit le dossier.

### Forme des fonctions

- Services : gardes d'abord, puis un happy path linéaire ; extraire un helper privé
  au-delà de ~80 lignes ou de complexité 12 (lint `max-lines-per-function` / `complexity`
  sur `src/lib/services` + `src/dal`).
- Promesses jamais flottantes (lint `no-floating-promises`) : `await`, `return`, ou
  `void` explicite. Envoi d'emails non bloquant après commit via `safeSend`.
- Imports de types en `import type` (lint `consistent-type-imports`).

### Couches (lint `no-restricted-imports`)

- Seuls `src/lib/services/**` accèdent en runtime à `@/dal` / `@/db` ;
  `import type` est accepté partout.
- Tolérances documentées : pages RSC (`app/**/page.tsx`) en **lecture seule**,
  `src/lib/auth.ts` et `src/lib/google-sync.ts` (infra/adaptateurs),
  `src/lib/dashboard.ts` (agrégat de lecture des pages).
- Écrire en base ou porter une règle métier depuis une page → déplacer dans un service.
