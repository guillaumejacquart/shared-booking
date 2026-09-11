# shared-booking — SPEC v1 (MVP)

Status: draft for validation — pilot-driven.
Last updated: 2026-09-11.

## 1. Context & decisions already made

* **Target:** private holistic therapy practices (no regulated medical use). No handling of legally binding medical data, no Doctolib-style compliance needed.
* **Pilot:** 1 office, 3 practitioners, 1 shared room (A) + 1 exclusive room (B, practitioner P1 only). P1 can receive in A or B.
* **Public pages:** both modes supported, toggled in settings. Main use case = **1 public page per practitioner**, with shared internal calendar.
* **Rooms:** required in MVP. Multiple rooms, 2–3 practitioners can share one room. No double-booking of a room.
* **Session types:** multiple per practitioner, each with its own duration + buffer.
* **Patient auth:** none. Email + magic cancel/reschedule link.
* **Notifications MVP:** email confirmation + email reminder. No SMS.
* **Cancellation:** configurable deadlines, both patient and practitioner can cancel.
* **i18n:** infrastructure from day one (`next-intl` or equivalent), only `fr` locale shipped. Timezone fixed `Europe/Paris` for now (stored, not user-selectable).
* **Billing:** free, no billing in MVP. Keep schema extensible (`plan` field) but no UI.

## 2. Goals / Non-goals

Goals (MVP):
* G1: A practitioner declares weekly availability in minutes, gets bookable slots without manual slot-drawing.
* G2: A patient books in < 1 min from a practitioner link, receives email confirmation, can cancel via magic link.
* G3: No double-booking — neither of a practitioner nor of a room.
* G4: The 3 practitioners see a shared office calendar (who is where, in which room).
* G5: Configurable guardrails: buffers, min booking lead time, cancel deadline, reminders.

Non-goals (post-MVP):
* Online payment / Stripe, SMS reminders, patient accounts, video calls, iCal/CalDAV sync, multi-office per user, practitioner billing, mobile app, SEO directory.

## 3. Personas & roles

| Role | Auth | Can do |
|---|---|---|
| `owner` (office creator, practitioner or manager) | authenticated | office settings, rooms CRUD, invite/remove practitioners, all calendars, all bookings |
| `practitioner` | authenticated (invite) | own availability, exceptions, session types, own bookings, view shared calendar |
| `patient` | unauthenticated | book / cancel / reschedule own booking via token link |

MVP simplification: `owner` is also a practitioner in the pilot. Support `owner` as non-practitioner (manager) but don't optimize for it.

## 4. Vocabulary

* **Office:** a shared cabinet. `slug` → `/o/[slug]`.
* **Practitioner:** member of an office with a public page `/p/[slug]`. Slug unique globally (simpler + allows future directory).
* **Room:** physical room in an office. Has allowlist of practitioners (empty = all office members).
* **SessionType:** a bookable service, e.g. "1ère séance 60min". `durationMin` + `bufferAfterMin`.
* **AvailabilityRule:** recurring weekly window in which a practitioner can receive, **in a given room**: "Tue 09:00–12:00 in Room A".
* **Exception:** one-off override: day off, holiday, or extra opening.
* **Slot:** generated bookable unit = AvailabilityRule ÷ SessionType durations, minus existing bookings, buffers, lead-time rules.
* **Booking:** a reserved slot + patient identity + room assignment + status + tokens.

## 5. Features (MVP)

### F1 — Office & settings
* Create office: name, slug (auto from name, editable, unique check), timezone fixed `Europe/Paris` (stored, displayed, not editable in MVP).
* Settings (owner only):
  * `enablePractitionerPages` (default ON)
  * `enableOfficePage` (default OFF — toggle to ON when ready)
  * `bookingLeadTimeMin` default 120 (can't book less than 2h before start)
  * `cancelDeadlineHours` default 24 (patient can't self-cancel after that, must call)
  * `reminderHoursBefore` default 24
  * `defaultBufferAfterMin` default 0 (overridable per session type)
* i18n: all strings via message catalogs, `fr` only.

### F2 — Practitioners & invites
* Owner invites by email → invite link (7-day expiry) → practitioner creates account (Better Auth), sets display name, slug, bio, photo (optional, local upload or URL in MVP — keep simple: URL or skip photo in MVP).
* Practitioner public profile fields: displayName, slug, bio (markdown-lite/plaintext), sessionTypes, contact email/phone (optional, shown on public page? default: email hidden, phone hidden — decide at build: show nothing except booking form).
* Deactivate (not delete) a practitioner: hides pages, blocks new bookings, keeps history.

### F3 — Rooms
* Room fields: `id, officeId, name ("Salle A"), color (for calendar), allowedPractitionerIds[]` (empty = all).
* Validation: at least 1 room per office. Deleting a room with future bookings → forbidden (must move/empty first).
* Pilot mapping:
  * Room A: allowed = [P1, P2, P3]
  * Room B: allowed = [P1] (exclusive)
* Capacity = 1 booking at a time per room (no overlapping bookings in same room, including buffers).

### F4 — Session types
* Fields per practitioner: `name, description?, durationMin (15/30/45/60/90/120 presets + custom), bufferAfterMin (default from office), price? (display only, optional, no payment), active flag`.
* Example: P1: "Découverte 30min + 10min buffer", "Séance complète 60min + 15min buffer".
* Changing duration does not affect existing bookings. Deactivating hides from public page but keeps history.

### F5 — Weekly availability (recurring)
* Per practitioner, per weekday, list of windows: `{ weekday 0–6, start "09:00", end "12:00", roomId }`.
* Rules:
  * `start < end`, no overlap between two windows of the **same practitioner** (error message, prevent save).
  * `roomId` must be a room the practitioner is allowed in.
  * This is what makes P1's case work: P1 sets "Mon 09:00–12:00 in B" and "Tue 09:00–12:00 in A".
* UX: week-grid editor (Mon–Sun rows, add window, pick room via color dot). Copy week-to-week not needed (it's recurring by nature).

### F6 — Exceptions (one-off)
* Two kinds:
  1. **Unavailable** (day off / holiday / training): `{ date, fullDay }` or `{ date, start, end }` — blocks slot generation.
  2. **Extra opening**: `{ date, start, end, roomId }` — adds bookable time outside recurring rules (e.g. Saturday morning).
* Past exceptions immutable-ish (can delete, no effect). List + calendar highlighting.

### F7 — Slot generation & conflict rules (core algorithm)
Fixed timezone `Europe/Paris` everywhere. Store `startAt/endAt` as UTC timestamps, display in Europe/Paris.

Generation for (practitioner, sessionType, dateRange):
1. Take AvailabilityRules for weekday + Extra openings for that date, minus Unavailable exceptions.
2. Slice each window into back-to-back slots of `durationMin`, each followed by `bufferAfterMin` (buffer is **blocked** but not bookable).
   * Example: window 09:00–12:00, 45min + 10min buffer → 09:00, 09:55, 10:50. 11:45 would end 12:30 → excluded.
3. Exclude slots that:
   * start before `now + bookingLeadTimeMin`,
   * overlap any existing non-cancelled booking of the **same practitioner** (including its buffer),
   * overlap any non-cancelled booking in the **same room** (including its buffer),
   * overlap an Unavailable exception.
4. Room is fixed at generation time (comes from the AvailabilityRule). No auto-reassignment in MVP — if P1 opens Tue morning in A, those slots are in A, period. If P1 wants choice, they open two windows (but overlapping own windows are forbidden → they must pick one room per window; to offer both they use different days/halves, which matches the pilot).

> Deliberate MVP simplification: no "book me in any free room" logic. Explicit room per availability window. Auto-fallback is P1 scope.

### F8 — Public booking (unauthenticated)
Routes:
* `/p/[practitionerSlug]` — main flow (enabled if `enablePractitionerPages`).
* `/o/[officeSlug]` — office page listing practitioners + session types (enabled if `enableOfficePage`). Links through to the same booking widget pre-filled with practitioner.

Flow (3 steps, no account):
1. Pick session type → calendar (2-week horizon default, configurable 1–8 weeks) showing free days → pick slot.
2. Form: firstName, lastName, email (required), phone (optional but recommended), notes (optional, 500 chars), consent checkbox ("J'ai compris qu'il s'agit d'une pratique de bien-être non médicale" — static FR text, required).
3. Confirm → success screen + email with ICS attachment + magic links (cancel / reschedule).

Validation:
* Email format, required fields, slot still free at submit (re-check in transaction, optimistic locking: `SELECT ... FOR UPDATE` or unique constraint on `(practitionerId, startAt)` + room overlap check in same transaction).
* Rate-limit booking endpoint per IP (e.g. 20/hour) to avoid spam.
* Honeypot field for bots (cheap, no captcha in MVP).

Booking fields: `id, officeId, practitionerId, roomId (snapshot), sessionTypeId (snapshot of name/duration/price), startAt, endAt, bufferAfterMin (snapshot), patientFirstName, patientLastName, patientEmail, patientPhone?, notes?, status, cancelToken, rescheduleToken, createdAt`.

Price snapshot: store displayed price at booking time (display only).

### F9 — Booking lifecycle
States: `confirmed → cancelled | completed`. (`pending` not needed — no payment.)

* **Patient cancel** via magic link: allowed only if `now < startAt - cancelDeadlineHours`. After deadline → page says "contactez directement le praticien" (show practitioner's public contact if set, else office contact).
* **Patient reschedule** via magic link: same deadline; flow = pick new slot (same session type, same practitioner) → atomic move; old slot freed; new confirmation email; keep same tokens.
* **Practitioner/owner cancel**: always allowed, with mandatory reason field (stored, included in patient email). No deadline.
* **Completion:** nightly job marks past `confirmed` bookings as `completed` (for history stats; no email).
* **Reminders:** cron (hourly) sends email at `startAt - reminderHoursBefore` (±30min tolerance, idempotent `reminderSentAt` flag).
* All emails contain: practitioner, session type, date/time (Europe/Paris, e.g. "mardi 16 sept. à 9h00"), office address (add `address` field to office — needed for patients), room is **not** shown to patient (internal detail), cancel/reschedule links.

### F10 — Calendars (authenticated)
* **My agenda** (practitioner): day/week view, color by session type, click → booking detail drawer (patient info, notes, cancel, email again).
* **Shared office calendar** (all members): week view, one row/lane per practitioner + room badges (color dot + "Salle A"). Read-only for others' bookings except: owner sees patient names; non-owner practitioners see **masked** patient names for others (e.g. "Réservé — P2") to preserve privacy in a shared cabinet. Owner sees all.
  * Decision to validate: masking is cheap and avoids gossip. Keep it.
* Block time: practitioner can create an Unavailable exception directly from calendar ("Bloquer ce créneau").

### F11 — Emails (FR only in MVP)
* Templates (plaintext + minimal HTML): invite, booking confirmation (+ICS), reminder, patient-cancelled (to practitioner), practitioner-cancelled (to patient), rescheduled.
* Provider: nodemailer via SMTP env (same pattern as other projects, `serverExternalPackages: ["nodemailer"]`). No tracking pixels.
* Dev mode: log to console (no SMTP required to boot).

## 6. Data model (Drizzle + SQLite, sketch)

```
offices(id, name, slug UNIQUE, address, timezone DEFAULT 'Europe/Paris',
  enablePractitionerPages DEFAULT 1, enableOfficePage DEFAULT 0,
  bookingLeadTimeMin DEFAULT 120, cancelDeadlineHours DEFAULT 24,
  reminderHoursBefore DEFAULT 24, defaultBufferAfterMin DEFAULT 0)

users (via Better Auth) + members(officeId, userId, role 'owner|practitioner', active)
practitioners(id, officeId, userId UNIQUE, displayName, slug UNIQUE, bio,
  publicContact?, active DEFAULT 1)

rooms(id, officeId, name, color, sortOrder)
room_members(roomId, practitionerId)  // empty set = everyone allowed; else allowlist

session_types(id, practitionerId, name, description, durationMin, bufferAfterMin, priceDisplay?, active DEFAULT 1)

availability_rules(id, practitionerId, weekday, startTime 'HH:MM', endTime 'HH:MM', roomId)
exceptions(id, practitionerId, date 'YYYY-MM-DD', kind 'off|extra', startTime?, endTime?, fullDay DEFAULT 0, roomId?, reason?)

bookings(id, officeId, practitionerId, roomId, sessionTypeId,
  sessionNameSnapshot, durationMinSnapshot, bufferAfterMinSnapshot,
  startAt INTEGER (unix ms UTC), endAt INTEGER,
  patientFirstName, patientLastName, patientEmail, patientPhone?, notes?,
  status 'confirmed|cancelled|completed', cancelToken UNIQUE, rescheduleToken UNIQUE,
  reminderSentAt?, cancelledAt?, cancelReason?, createdAt)
```

Indexes: `bookings(practitionerId, startAt)`, `bookings(roomId, startAt)`, `availability_rules(practitionerId, weekday)`.

Overlap checks must be done in a transaction (SQLite: `BEGIN IMMEDIATE`) checking both practitioner and room windows including buffer: booked occupancy = `[startAt, endAt + bufferAfterMin]`.

## 7. Pilot acceptance scenarios (must pass)

1. P1 opens Mon 09:00–12:00 in B (60min sessions) → patient books Mon 09:00 → P2 cannot be booked in B (not allowed anyway) and P1's 09:00 gone; P2 can still be booked in A at 09:00.
2. P2 and P3 both open Tue 09:00–12:00 in A → first booking at 09:00 by P2's patient blocks 09:00–09:45+buffer in A → P3's 09:00 slot disappears, 10:00 (after buffer) remains.
3. Session types with buffers: 45min + 15min buffer from 09:00 → next slot 10:00, not 09:45.
4. Cancel deadline: office set to 24h → patient cancelling 2h before gets "contactez le praticien" page; practitioner can still cancel with reason.
5. Toggles: owner disables office page → `/o/slug` 404 with friendly message; practitioner pages still work.

## 8. UX notes (keep light for MVP)

* Authenticated: single sidebar (Mon agenda / Calendrier partagé / Disponibilités / Types de séances / Salles (owner) / Paramètres (owner)).
* Public: mobile-first, 3 steps max, no login wall, FR copy with well-being disclaimer.
* Shared calendar: week grid, practitioner lanes, room color dots. No drag-and-drop in MVP (click to view, form to edit).

## 9. Technical notes

* Stack: Next.js (standalone for Docker, same as other projects), Better Auth, Drizzle + better-sqlite3, nodemailer, node-cron (reminders + auto-complete), Zod.
* Time: store UTC ms, format with `Europe/Paris` via `Intl`. DST-safe because we generate from wall-clock rules per date (recompute per day, don't cache across DST change).
* Horizon: generate slots on demand for requested date range (no pre-materialization). Cache nothing in MVP.
* Magic links: `crypto.randomBytes(32)` hex tokens, separate cancel/reschedule tokens, constant-time compare not needed but use indexed lookup. Consider expiry: cancel token valid until booking end; no separate expiry.
* Abuse: rate-limit public booking APIs, honeypot, max 3 future bookings per email+practitioner (configurable? hardcode 3 in MVP to limit squatting).
* Backup: same R2 recipe as other projects (SQLite). Include from day one per AGENTS.md.

## 10. Explicitly out of MVP

Payments, SMS, patient accounts, recurring bookings (abonnements), group sessions (>1 patient/slot), waiting list, video links, iCal feed in/out (except ICS attachment on confirmation), multi-office, billing UI, analytics, SEO directory, photo uploads (URL only or skip).

## 11. Next steps

### Paiement Stripe (implémenté)

- Par type de séance : `requiresPayment` + `priceCents`/`currency` (+ affichage
  `priceDisplay`), et/ou `requiresValidation`.
- Statuts : `pending` → `confirmed` quand (payé si requis) ET (validé si requis).
  Un `pending` tient le créneau (anti double-réservation) ; les pendings
  impayés expirent après 30 min (sweep `*/10 * * * *`).
- Webhook `POST /api/stripe/webhook` (`checkout.session.completed`, signature
  vérifiée, idempotent). Page retour `/p/[slug]/merci` (poll de statut).
- Annuler un RDV payé ne rembourse pas (manuel via dashboard Stripe).
- MVP : un seul compte Stripe plateforme (Connect plus tard).

### Reste à faire

1. Validation praticien (UI agenda : valider/refuser les pendings).
2. RDV créés par le praticien (téléphone) depuis l'agenda.
3. Déployer sur le VPS et tester avec le cabinet pilote.
