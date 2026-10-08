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

Par type de séance : gratuit (défaut), payant (`requiresPayment` + un prix par
**déclinaison**), et/ou validation manuelle (`requiresValidation`). Chaque séance
regroupe 1 à 6 déclinaisons durée/prix (ex. « Massage du corps » → 60 min / 60 €
et 90 min / 80 €, chacune avec son battement). Un RDV payant reste
`pending` (créneau tenu 30 min) jusqu'au webhook `checkout.session.completed`,
puis confirmé sauf si validation requise. Annuler un RDV payé ne rembourse
pas : remboursement manuel via le dashboard Stripe.

1. Clés `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (voir `.env.example`).
   Commission éventuelle via `STRIPE_APPLICATION_FEE_CENTS` (0 = reversement intégral).
2. Webhook Stripe → `https://<domaine>/api/stripe/webhook` (événements
   `checkout.session.completed`, `customer.subscription.*` + `account.updated`).
   Tester en local avec `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
3. Sans clé, toute réservation payante est rejetée proprement (400).

Stripe Connect Express (destination charges) : chaque praticien lie son
compte via **Profil → Paiements** (onboarding KYC/IBAN géré par Stripe).
Le checkout encaisse sur la plateforme puis reverse automatiquement sur le
compte du praticien (`transfer_data.destination`, moins la commission).
Tant que le praticien n'a pas finalisé son onboarding (`charges_enabled`),
ses séances payantes sont rejetées proprement (400).

Annuler un RDV payé ne rembourse pas : remboursement manuel via le dashboard
Stripe (à terme : bouton praticien via `refunds.create`).

## Abonnement SaaS (Stripe Billing, derrière feature flag)

1 abonnement par cabinet (10 €/mois), payé par le owner via
**Paramètres → Abonnement** (checkout `mode: subscription` + portail Stripe
pour factures/résiliation). Non bloquant : sans abonnement actif, un bandeau
le rappelle dans le dashboard, les réservations restent possibles.

Feature flag `SUBSCRIPTION_ENABLED` (voir `.env.example`, défaut `false`) :
à `false`, le bandeau et l'onglet Abonnement sont masqués, le
checkout/portail/refresh renvoient 400 et tout le monde utilise le service
sans restriction ni paiement. À `true`, le comportement ci-dessus s'applique.
Le webhook `customer.subscription.*` persiste le statut dans tous les cas
(réactivation sans perte d'état).

1. Prix `STRIPE_SUBSCRIPTION_PRICE_ID` (voir `.env.example` ; prix test 10 €/mois
déjà créé : `price_1UO27KB5HdKRRKyHy9ERmyeo`). Sans prix, la facturation est
désactivée (bandeau masqué).
2. Mêmes webhook que ci-dessus (`customer.subscription.*` met à jour le statut
   du cabinet : `trialing`/`active` = à jour).

## Google Agenda (push outbound, optionnel)

Chaque praticien peut recopier ses réservations confirmées dans son agenda
Google (création / report / annulation). Sans configuration, tout reste
local et l'onglet « Google Agenda » du profil l'indique.

1. Créer un projet sur https://console.cloud.google.com, activer **Calendar API**,
   créer des identifiants OAuth (application Web) avec le scope
   `.../auth/calendar.events`. Origine + redirection autorisées =
   `BETTER_AUTH_URL` (ex. `https://shared-booking.guillaumejacquart.com`
   et `/api/auth/callback/google`).
2. Renseigner `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (voir `.env.example` ;
   en prod : fichier `shared-booking.env` du VPS, jamais dans git).
3. Côté praticien : onglet **Profil → Google Agenda** → « Connecter Google »,
   choisir l'agenda de destination, activer la recopie.

Confidentialité : événements anonymisés (« Réservé », ni nom ni contact) par
défaut ; l'affichage du nom patient est un opt-in explicite. Échec de push =
statut `error` sur la réservation + retry auto toutes les 15 min (bouton
« Resynchroniser » en plus). Les patients ont de toute façon le lien
« Ajouter à Google Agenda » (sans compte) dans l'email et sur la page de
confirmation.

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

Recette VPS standard (`AGENTS.md`) : DNS `shared-booking.guillaumejacquart.com` +
`lecabinetpartage.fr` (enregistrements A → IP du VPS) →
`npm run deploy` après un push sur `main` (image GHCR `linux/arm64`).
Ne jamais déployer sans demande explicite.

## Domaine (cutover effectué le 2026-10-07)

Domaine canonique : `lecabinetpartage.fr` (`BETTER_AUTH_URL`). L'ancien
(`shared-booking.guillaumejacquart.com`) reste servi en alias Traefik le temps
que les anciens liens (emails déjà envoyés, bookmarks) s'éteignent.

Nettoyage final (plus tard) :

1. Retirer le `Host(\`shared-booking.guillaumejacquart.com\`)` du compose.
2. Resserrer `trustedOrigins` dans `src/lib/auth.ts` (nouveau domaine seul).
3. `npm run deploy`.
