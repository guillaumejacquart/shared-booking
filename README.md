# shared-booking

Réservation en ligne pour cabinets partagés de pratiques bien-être : les
praticiens déclarent leurs disponibilités (avec gestion des salles partagées),
les patients réservent sans compte via une page publique.

Spec produit : [`SPEC.md`](./SPEC.md).

## Développement

```bash
npm install
cp .env.example .env.local   # ajuster si besoin
npm run db:push               # crée local.db
npm run db:seed               # démo : Cabinet des Tilleuls (mot de passe affiché)
npm run dev                   # http://localhost:3000
```

Pages démo : `/o/tilleuls`, `/p/camille`.

## Commandes

| Commande            | Rôle                                    |
| ------------------- | --------------------------------------- |
| `npm test`          | vitest (moteur de créneaux, services, backup) |
| `npm run typecheck` | `tsc --noEmit`                          |
| `npm run lint`      | eslint                                  |
| `npm run build`     | build Next de prod                      |
| `npm run db:generate` / `db:push` / `db:studio` | migrations Drizzle |
| `npm run deploy`    | déploiement VPS (prod uniquement, sur demande) |

## API publique

- `GET /api/p/[slug]/slots?sessionTypeId=&from=YYYY-MM-DD&days=` — créneaux (salle exclue)
- `POST /api/p/[slug]/bookings` — réservation (rate-limit 20/h/IP + honeypot)
- `POST /api/b/cancel` — `{ token, by: "patient" | "practitioner", reason? }`
- `POST /api/b/reschedule` — `{ token, newStartAt }`

Erreurs : 400 invalide, 404 inconnu, 409 pris, 410 deadline dépassée, 429 rate-limit.

## Paiement (Stripe Checkout, optionnel)

Par type de séance : gratuit (défaut), payant (`requiresPayment` + prix),
et/ou validation manuelle (`requiresValidation`). Un RDV payant reste
`pending` (créneau tenu 30 min) jusqu'au webhook `checkout.session.completed`,
puis confirmé sauf si validation requise. Annuler un RDV payé ne rembourse
pas : remboursement manuel via le dashboard Stripe.

1. Clés `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (voir `.env.example`).
2. Webhook Stripe → `https://<domaine>/api/stripe/webhook` (événement
   `checkout.session.completed`). Tester en local avec `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
3. Sans clé, toute réservation payante est rejetée proprement (400).

Limite MVP : un seul compte Stripe pour tout le SaaS (pas de reversement
par praticien — Stripe Connect plus tard).

## Backups (SQLite → Cloudflare R2)

Le process Next sauvegarde la base chaque jour, sans cron hôte :

1. Créer le bucket R2 `shared-booking-backups` + token Object Read+Write, lifecycle 30 jours.
2. Renseigner `R2_*` dans l'environnement (voir `.env.example`).
3. Vérifier dans les logs : `backup scheduler on: "0 3 * * *" Europe/Paris -> s3://…`.
4. Test immédiat : `BACKUP_ON_STARTUP=true` → chercher `backup ok: sqlite/shared-booking-….db.gz`, puis repasser à `false`.

Sans `R2_*`, l'app démarre normalement (`backup scheduler off: …`).

Restaurer :

```bash
aws --endpoint-url "$R2_ENDPOINT" s3 cp s3://shared-booking-backups/sqlite/shared-booking-<DATE>.db.gz /tmp/restore.db.gz
gunzip -c /tmp/restore.db.gz > /tmp/restore.db
sqlite3 /tmp/restore.db "PRAGMA integrity_check;"
```

## Déploiement

Recette VPS standard (`AGENTS.md`) : DNS `shared-booking.guillaumejacquart.com` →
`npm run deploy` après un push sur `main` (image GHCR `linux/arm64`).
Ne jamais déployer sans demande explicite.
