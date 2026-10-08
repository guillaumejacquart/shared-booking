import { getConnection } from "./connection";

import { and, asc, eq, gte, lt, lte, or, isNull } from "drizzle-orm";

import { booking, office, practitioner } from "@/db/schema";
import type { Booking, BookingDetail, DbOrTx, NewBooking } from "./types";

/**
 * Repository réservations : lectures + écritures atomiques.
 * Aucune logique métier ici : uniquement des requêtes typées.
 * La connexion est détenue par le DAL (`./connection`), jamais injectée.
 */

export interface BusyQuery {
  practitionerId?: string;
  practitionerIds?: string[];
  roomIds?: string[];
  excludeBookingId?: string;
  from: Date;
  to: Date;
}

/**
 * Réservations pouvant chevaucher [from, to] : `confirmed` + `pending`
 * (un pending tient le créneau pendant le paiement ou la validation).
 * Marge d'1 jour côté SQL (buffers < 24h, cf. validation service),
 * filtrage précis laissé à l'appelant via les snapshots durée/buffer.
 */
export async function listActiveBookings(query: BusyQuery) {
  const conn = getConnection();
  const margin = new Date(query.from.getTime() - 24 * 3_600_000);
  const conditions = [
    or(eq(booking.status, "confirmed"), eq(booking.status, "pending")),
    gte(booking.startAt, margin),
    lt(booking.startAt, query.to),
  ];
  if (query.practitionerId) conditions.push(eq(booking.practitionerId, query.practitionerId));
  if (query.practitionerIds) {
    conditions.push(
      or(...query.practitionerIds.map((id) => eq(booking.practitionerId, id)))!,
    );
  }
  if (query.roomIds) {
    conditions.push(or(...query.roomIds.map((id) => eq(booking.roomId, id)))!);
  }
  const rows = await conn
    .select()
    .from(booking)
    .where(and(...conditions));
  return query.excludeBookingId
    ? rows.filter((booking) => booking.id !== query.excludeBookingId)
    : rows;
}

async function bookingDetail(
  db: DbOrTx,
  booking: Booking,
): Promise<BookingDetail | null> {
  const pracRows = await db
    .select()
    .from(practitioner)
    .where(eq(practitioner.id, booking.practitionerId))
    .limit(1);
  const offRows = await db
    .select()
    .from(office)
    .where(eq(office.id, booking.officeId))
    .limit(1);
  if (!pracRows[0] || !offRows[0]) return null;
  return { booking: booking, practitioner: pracRows[0], office: offRows[0] };
}

export async function findBookingByCancelToken(token: string): Promise<BookingDetail | null> {
  const conn = getConnection();
  const rows = await conn
    .select()
    .from(booking)
    .where(eq(booking.cancelToken, token))
    .limit(1);
  if (!rows[0]) return null;
  return bookingDetail(conn, rows[0]);
}

export async function findBookingByRescheduleToken(token: string): Promise<BookingDetail | null> {
  const conn = getConnection();
  const rows = await conn
    .select()
    .from(booking)
    .where(eq(booking.rescheduleToken, token))
    .limit(1);
  if (!rows[0]) return null;
  return bookingDetail(conn, rows[0]);
}

export async function getBookingById(bookingId: string): Promise<BookingDetail | null> {
  const conn = getConnection();
  const rows = await conn
    .select()
    .from(booking)
    .where(eq(booking.id, bookingId))
    .limit(1);
  if (!rows[0]) return null;
  return bookingDetail(conn, rows[0]);
}

/** Ligne brute (sans jointures praticien/cabinet), pour les transitions d'état internes. */
export async function getBookingRowById(bookingId: string): Promise<Booking | null> {
  const conn = getConnection();
  const rows = await conn
    .select()
    .from(booking)
    .where(eq(booking.id, bookingId))
    .limit(1);
  return rows[0] ?? null;
}

/** Validation praticien enregistrée. */
export async function markBookingValidated(bookingId: string, now: Date) {
  const conn = getConnection();
  await conn
    .update(booking)
    .set({ validatedAt: now })
    .where(eq(booking.id, bookingId));
}

export async function findBookingByStripeSession(stripeSessionId: string): Promise<BookingDetail | null> {
  const conn = getConnection();
  const rows = await conn
    .select()
    .from(booking)
    .where(eq(booking.stripeSessionId, stripeSessionId))
    .limit(1);
  if (!rows[0]) return null;
  return bookingDetail(conn, rows[0]);
}

/** Paiement reçu : marque payé et lève l'expiration d'attente. Idempotent. */
export async function markBookingPaid(bookingId: string,
  stripePaymentIntentId: string | null) {
  const conn = getConnection();
  await conn
    .update(booking)
    .set({
      paymentStatus: "paid",
      stripePaymentIntentId,
      pendingExpiresAt: null,
    })
    .where(eq(booking.id, bookingId));
}

/** Bascule un `pending` en `confirmed` (toutes les conditions remplies). */
export async function markBookingConfirmed(bookingId: string) {
  const conn = getConnection();
  await conn
    .update(booking)
    .set({ status: "confirmed" })
    .where(eq(booking.id, bookingId));
}

/** Pendings expirés en attente de paiement (à annuler). */
export async function listExpiredPendings(now: Date) {
  const conn = getConnection();
  return conn
    .select()
    .from(booking)
    .where(
      and(
        eq(booking.status, "pending"),
        eq(booking.paymentStatus, "pending"),
        lt(booking.pendingExpiresAt, now),
      ),
    );
}

function occupancyEnd(booking: { startAt: Date; endAt: Date; bufferAfterMinSnapshot: number }): number {
  return booking.endAt.getTime() + booking.bufferAfterMinSnapshot * 60_000;
}

function collides(
  start: number,
  end: number, // occupation candidate [start, end), buffer inclus
  existing: { startAt: Date; endAt: Date; bufferAfterMinSnapshot: number },
): boolean {
  return start < occupancyEnd(existing) && existing.startAt.getTime() < end;
}

/**
 * Insertion avec garde anti double-réservation : revérifie les chevauchements
 * praticien + salle juste avant d'insérer. Retourne `{ conflict: true }` si le
 * créneau a été pris entre la lecture des disponibilités et l'insertion.
 *
 * NOTE : pas de `db.transaction()` ici — le driver better-sqlite3 de Drizzle
 * exige un callback synchrone. L'atomicité face aux requêtes concurrentes est
 * assurée par le mutex d'écriture du service (`bookingMutex`), valide car le
 * déploiement est mono-processus (un conteneur sur le VPS).
 */
export async function tryInsertBooking(data: NewBooking): Promise<{ conflict: true } | { conflict: false; id: string }> {
  const conn = getConnection();
  const start = data.startAt.getTime();
  const end = data.endAt.getTime() + data.bufferAfterMinSnapshot * 60_000;

  // Chevauchement praticien (toutes salles) OU salle (tous praticiens).
  const byPrac = await listActiveBookings({
    practitionerId: data.practitionerId,
    from: data.startAt,
    to: data.endAt,
  });
  const byRoom = await listActiveBookings({
    roomIds: [data.roomId],
    from: data.startAt,
    to: data.endAt,
  });
  const seen = new Map(byPrac.map((booking) => [booking.id, booking]));
  for (const booking of byRoom) seen.set(booking.id, booking);
  if ([...seen.values()].some((booking) => collides(start, end, booking))) {
    return { conflict: true as const };
  }
  const ids = await conn
    .insert(booking)
    .values({
      id: data.id,
      officeId: data.officeId,
      practitionerId: data.practitionerId,
      roomId: data.roomId,
      sessionTypeId: data.sessionTypeId,
      sessionVariantId: data.sessionVariantId ?? null,
      sessionNameSnapshot: data.sessionNameSnapshot,
      durationMinSnapshot: data.durationMinSnapshot,
      bufferAfterMinSnapshot: data.bufferAfterMinSnapshot,
      priceCentsSnapshot: data.priceCentsSnapshot,
      priceDisplaySnapshot: data.priceDisplaySnapshot,
      currencySnapshot: data.currencySnapshot,
      startAt: data.startAt,
      endAt: data.endAt,
      patientFirstName: data.patientFirstName,
      patientLastName: data.patientLastName,
      patientEmail: data.patientEmail,
      patientPhone: data.patientPhone ?? null,
      notes: data.notes ?? null,
      status: data.status ?? "confirmed",
      paymentStatus: data.paymentStatus ?? "none",
      stripeSessionId: data.stripeSessionId ?? null,
      validationRequired: data.validationRequired ?? false,
      pendingExpiresAt: data.pendingExpiresAt ?? null,
      cancelToken: data.cancelToken,
      rescheduleToken: data.rescheduleToken,
    })
    .returning({ id: booking.id });
  return { conflict: false as const, id: ids[0].id };
}

/**
 * Déplacement d'une réservation (même garde anti-conflit, en excluant la
 * réservation déplacée elle-même). Même NOTE que `tryInsertBooking` : à
 * appeler sous `bookingMutex` côté service.
 */
export async function tryMoveBooking(bookingId: string,
  move: { startAt: Date; endAt: Date; roomId: string }): Promise<boolean> {
  const conn = getConnection();
  const rows = await conn
    .select()
    .from(booking)
    .where(eq(booking.id, bookingId))
    .limit(1);
  const current = rows[0];
  if (!current || current.status !== "confirmed") return false;
  const start = move.startAt.getTime();
  const end = move.endAt.getTime() + current.bufferAfterMinSnapshot * 60_000;

  const byPrac = await listActiveBookings({
    practitionerId: current.practitionerId,
    excludeBookingId: bookingId,
    from: move.startAt,
    to: move.endAt,
  });
  const byRoom = await listActiveBookings({
    roomIds: [move.roomId],
    excludeBookingId: bookingId,
    from: move.startAt,
    to: move.endAt,
  });
  const seen = new Map(byPrac.map((booking) => [booking.id, booking]));
  for (const booking of byRoom) seen.set(booking.id, booking);
  if ([...seen.values()].some((booking) => collides(start, end, booking))) return false;

  await conn
    .update(booking)
    .set({ startAt: move.startAt, endAt: move.endAt, roomId: move.roomId })
    .where(eq(booking.id, bookingId));
  return true;
}

export async function markBookingCancelled(bookingId: string,
  reason: string | null,
  now: Date,
  by: "patient" | "practitioner" | null = null) {
  const conn = getConnection();
  await conn
    .update(booking)
    .set({ status: "cancelled", cancelledAt: now, cancelReason: reason, cancelledBy: by })
    .where(eq(booking.id, bookingId));
}

export async function countFutureConfirmedByEmail(practitionerId: string,
  email: string,
  now: Date): Promise<number> {
  const conn = getConnection();
  const rows = await conn
    .select({ id: booking.id })
    .from(booking)
    .where(
      and(
        eq(booking.practitionerId, practitionerId),
        eq(booking.patientEmail, email),
        eq(booking.status, "confirmed"),
        gte(booking.startAt, now),
      ),
    );
  return rows.length;
}

// --- Rappels & clôture (cron) ---

export async function listRemindersDue(now: Date) {
  const conn = getConnection();
  // Le service filtre précisément par office.reminderHoursBefore ; ici on
  // présélectionne large (départ dans moins de 48h, rappel non envoyé).
  const horizon = new Date(now.getTime() + 48 * 3_600_000);
  const rows = await conn
    .select()
    .from(booking)
    .where(
      and(
        eq(booking.status, "confirmed"),
        isNull(booking.reminderSentAt),
        lte(booking.startAt, horizon),
      ),
    );
  return rows.filter((booking) => booking.startAt.getTime() > now.getTime());
}

export async function markReminderSent(bookingId: string, now: Date) {
  const conn = getConnection();
  await conn
    .update(booking)
    .set({ reminderSentAt: now })
    .where(eq(booking.id, bookingId));
}

/** Bascule les RDV passés en `completed`. Retourne le nombre de lignes. */
export async function completePastBookings(now: Date): Promise<number> {
  const conn = getConnection();
  const rows = await conn
    .update(booking)
    .set({ status: "completed" })
    .where(and(eq(booking.status, "confirmed"), lt(booking.endAt, now)))
    .returning({ id: booking.id });
  return rows.length;
}

// --- Gestion (tableau de bord) ---

/** Réservations d'un praticien sur une période (tous statuts, pour l'agenda). */
export async function listBookingsForPractitioner(practitionerId: string,
  from: Date,
  to: Date) {
  const conn = getConnection();
  return conn
    .select()
    .from(booking)
    .where(
      and(
        eq(booking.practitionerId, practitionerId),
        gte(booking.startAt, new Date(from.getTime() - 24 * 3_600_000)),
        lt(booking.startAt, to),
      ),
    );
}

/** Réservations d'un praticien dont la séance démarre dans [from, to[ (tous statuts, stats). */
export async function listBookingsForStats(practitionerId: string,
  from: Date,
  to: Date) {
  const conn = getConnection();
  return conn
    .select()
    .from(booking)
    .where(
      and(
        eq(booking.practitionerId, practitionerId),
        gte(booking.startAt, from),
        lt(booking.startAt, to),
      ),
    )
    .orderBy(asc(booking.startAt));
}

/** Emails patients connus avant `from` (RDV non en attente, pour nouveau vs revenant). */
export async function listPatientEmailsBefore(practitionerId: string,
  from: Date): Promise<string[]> {
  const conn = getConnection();
  const rows = await conn
    .select({ email: booking.patientEmail })
    .from(booking)
    .where(
      and(
        eq(booking.practitionerId, practitionerId),
        lt(booking.startAt, from),
        or(
          eq(booking.status, "confirmed"),
          eq(booking.status, "cancelled"),
          eq(booking.status, "completed"),
        ),
      ),
    );
  return [...new Set(rows.map((row) => row.email))];
}

/** Demandes en attente de validation d'un praticien (triées par horaire). */
export async function listPendingValidationForPractitioner(practitionerId: string) {
  const conn = getConnection();
  return conn
    .select()
    .from(booking)
    .where(
      and(
        eq(booking.practitionerId, practitionerId),
        eq(booking.status, "pending"),
        eq(booking.validationRequired, true),
      ),
    )
    .orderBy(asc(booking.startAt));
}

/** Nombre de demandes en attente de validation (pastille de navigation). */
export async function countPendingValidationForPractitioner(
  practitionerId: string,
): Promise<number> {
  const conn = getConnection();
  const rows = await conn
    .select({ id: booking.id })
    .from(booking)
    .where(
      and(
        eq(booking.practitionerId, practitionerId),
        eq(booking.status, "pending"),
        eq(booking.validationRequired, true),
      ),
    );
  return rows.length;
}

/** Réservations confirmées à venir d'un praticien (triées par horaire). */
export async function listUpcomingConfirmedForPractitioner(
  practitionerId: string,
  now: Date,
) {
  const conn = getConnection();
  return conn
    .select()
    .from(booking)
    .where(
      and(
        eq(booking.practitionerId, practitionerId),
        eq(booking.status, "confirmed"),
        gte(booking.startAt, now),
      ),
    )
    .orderBy(asc(booking.startAt));
}

/** Réservations non annulées d'un cabinet (calendrier partagé). */
export async function listOfficeBookings(officeId: string,
  from: Date,
  to: Date) {
  const conn = getConnection();
  const rows = await conn
    .select()
    .from(booking)
    .where(
      and(
        eq(booking.officeId, officeId),
        gte(booking.startAt, new Date(from.getTime() - 24 * 3_600_000)),
        lt(booking.startAt, to),
      ),
    );
  return rows.filter((booking) => booking.status !== "cancelled");
}

// --- Push Google Agenda (outbound) ---

export type GoogleSyncStatus = "none" | "pending" | "ok" | "error";

export async function setGoogleSync(
  bookingId: string,
  sync: {
    status: GoogleSyncStatus;
    eventId?: string | null;
    error?: string | null;
  },
): Promise<void> {
  const conn = getConnection();
  await conn
    .update(booking)
    .set({
      googleSyncStatus: sync.status,
      ...(sync.eventId !== undefined ? { googleEventId: sync.eventId } : {}),
      ...(sync.error !== undefined ? { googleSyncError: sync.error } : {}),
    })
    .where(eq(booking.id, bookingId));
}

/** Réservations confirmées/annulées dont le push Google est en attente ou en erreur (retry cron). */
export async function listGoogleSyncDue(limit = 50) {
  const conn = getConnection();
  return conn
    .select()
    .from(booking)
    .where(
      or(
        eq(booking.googleSyncStatus, "pending"),
        eq(booking.googleSyncStatus, "error"),
      ),
    )
    .limit(limit);
}

/** Sous-ensemble « à resynchroniser » pour un praticien (bouton dashboard). */
export async function listGoogleSyncDueForPractitioner(
  practitionerId: string,
  limit = 50,
) {
  const conn = getConnection();
  return conn
    .select()
    .from(booking)
    .where(
      and(
        eq(booking.practitionerId, practitionerId),
        or(
          eq(booking.googleSyncStatus, "pending"),
          eq(booking.googleSyncStatus, "error"),
        ),
      ),
    )
    .limit(limit);
}
