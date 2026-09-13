import { getConnection } from "./connection";

import { and, eq, gte, lt, lte, or, isNull } from "drizzle-orm";

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
export async function listActiveBookings(q: BusyQuery) {
  const conn = getConnection();
  const margin = new Date(q.from.getTime() - 24 * 3_600_000);
  const conditions = [
    or(eq(booking.status, "confirmed"), eq(booking.status, "pending")),
    gte(booking.startAt, margin),
    lt(booking.startAt, q.to),
  ];
  if (q.practitionerId) conditions.push(eq(booking.practitionerId, q.practitionerId));
  if (q.practitionerIds) {
    conditions.push(
      or(...q.practitionerIds.map((id) => eq(booking.practitionerId, id)))!,
    );
  }
  if (q.roomIds) {
    conditions.push(or(...q.roomIds.map((id) => eq(booking.roomId, id)))!);
  }
  const rows = await conn
    .select()
    .from(booking)
    .where(and(...conditions));
  return q.excludeBookingId
    ? rows.filter((b) => b.id !== q.excludeBookingId)
    : rows;
}

async function bookingDetail(
  db: DbOrTx,
  b: Booking,
): Promise<BookingDetail | null> {
  const pracRows = await db
    .select()
    .from(practitioner)
    .where(eq(practitioner.id, b.practitionerId))
    .limit(1);
  const offRows = await db
    .select()
    .from(office)
    .where(eq(office.id, b.officeId))
    .limit(1);
  if (!pracRows[0] || !offRows[0]) return null;
  return { booking: b, practitioner: pracRows[0], office: offRows[0] };
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

function occupancyEnd(b: { startAt: Date; endAt: Date; bufferAfterMinSnapshot: number }): number {
  return b.endAt.getTime() + b.bufferAfterMinSnapshot * 60_000;
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
  const seen = new Map(byPrac.map((b) => [b.id, b]));
  for (const b of byRoom) seen.set(b.id, b);
  if ([...seen.values()].some((b) => collides(start, end, b))) {
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
      sessionNameSnapshot: data.sessionNameSnapshot,
      durationMinSnapshot: data.durationMinSnapshot,
      bufferAfterMinSnapshot: data.bufferAfterMinSnapshot,
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
  const seen = new Map(byPrac.map((b) => [b.id, b]));
  for (const b of byRoom) seen.set(b.id, b);
  if ([...seen.values()].some((b) => collides(start, end, b))) return false;

  await conn
    .update(booking)
    .set({ startAt: move.startAt, endAt: move.endAt, roomId: move.roomId })
    .where(eq(booking.id, bookingId));
  return true;
}

export async function markBookingCancelled(bookingId: string,
  reason: string | null,
  now: Date) {
  const conn = getConnection();
  await conn
    .update(booking)
    .set({ status: "cancelled", cancelledAt: now, cancelReason: reason })
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
  return rows.filter((b) => b.startAt.getTime() > now.getTime());
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
  return rows.filter((b) => b.status !== "cancelled");
}
