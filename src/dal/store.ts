import {
  and,
  eq,
  gte,
  lt,
  lte,
  or,
  isNull,
} from "drizzle-orm";

import {
  availabilityRule,
  booking,
  exception,
  invite,
  member,
  office,
  practitioner,
  room,
  roomMember,
  sessionType,
  user,
} from "@/db/schema";
import type {
  Booking,
  DbOrTx,
  Office,
  Practitioner,
  SessionType,
} from "./types";

/**
 * Store d'accès aux données du domaine réservation (lectures + écritures
 * atomiques). Aucune logique métier ici : uniquement des requêtes typées.
 * Chaque fonction accepte connexion ou transaction (`DbOrTx`).
 */

export interface PractitionerPage {
  practitioner: Practitioner;
  office: Office;
  sessionTypes: SessionType[];
}

/** Page publique praticien : null si slug inconnu, praticien inactif ou pages désactivées. */
export async function getPractitionerPage(
  db: DbOrTx,
  slug: string,
): Promise<PractitionerPage | null> {
  const rows = await db
    .select()
    .from(practitioner)
    .where(and(eq(practitioner.slug, slug), eq(practitioner.active, true)))
    .limit(1);
  const prac = rows[0];
  if (!prac) return null;

  const officeRows = await db
    .select()
    .from(office)
    .where(eq(office.id, prac.officeId))
    .limit(1);
  const off = officeRows[0];
  if (!off || !off.enablePractitionerPages) return null;

  const types = await db
    .select()
    .from(sessionType)
    .where(
      and(
        eq(sessionType.practitionerId, prac.id),
        eq(sessionType.active, true),
      ),
    );
  return { practitioner: prac, office: off, sessionTypes: types };
}

export async function listRules(db: DbOrTx, practitionerId: string) {
  return db
    .select()
    .from(availabilityRule)
    .where(eq(availabilityRule.practitionerId, practitionerId));
}

export async function countRulesByRoom(db: DbOrTx, roomId: string): Promise<number> {
  const rows = await db
    .select({ id: availabilityRule.id })
    .from(availabilityRule)
    .where(eq(availabilityRule.roomId, roomId));
  return rows.length;
}

export async function listExceptions(
  db: DbOrTx,
  practitionerId: string,
  fromDate: string, // "YYYY-MM-DD" — comparaison lexicographique valide
  toDate: string,
) {
  return db
    .select()
    .from(exception)
    .where(
      and(
        eq(exception.practitionerId, practitionerId),
        gte(exception.date, fromDate),
        lte(exception.date, toDate),
      ),
    );
}

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
export async function listActiveBookings(db: DbOrTx, q: BusyQuery) {
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
  const rows = await db
    .select()
    .from(booking)
    .where(and(...conditions));
  return q.excludeBookingId
    ? rows.filter((b) => b.id !== q.excludeBookingId)
    : rows;
}

export async function getUserEmail(
  db: DbOrTx,
  userId: string,
): Promise<string | null> {
  const rows = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return rows[0]?.email ?? null;
}

export interface BookingDetail {
  booking: Booking;
  practitioner: Practitioner;
  office: Office;
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

export async function findBookingByCancelToken(
  db: DbOrTx,
  token: string,
): Promise<BookingDetail | null> {
  const rows = await db
    .select()
    .from(booking)
    .where(eq(booking.cancelToken, token))
    .limit(1);
  if (!rows[0]) return null;
  return bookingDetail(db, rows[0]);
}

export async function findBookingByRescheduleToken(
  db: DbOrTx,
  token: string,
): Promise<BookingDetail | null> {
  const rows = await db
    .select()
    .from(booking)
    .where(eq(booking.rescheduleToken, token))
    .limit(1);
  if (!rows[0]) return null;
  return bookingDetail(db, rows[0]);
}

export async function getBookingById(db: DbOrTx, bookingId: string): Promise<BookingDetail | null> {
  const rows = await db
    .select()
    .from(booking)
    .where(eq(booking.id, bookingId))
    .limit(1);
  if (!rows[0]) return null;
  return bookingDetail(db, rows[0]);
}

/** Validation praticien enregistrée. */
export async function markBookingValidated(db: DbOrTx, bookingId: string, now: Date) {
  await db
    .update(booking)
    .set({ validatedAt: now })
    .where(eq(booking.id, bookingId));
}

export async function findBookingByStripeSession(
  db: DbOrTx,
  stripeSessionId: string,
): Promise<BookingDetail | null> {
  const rows = await db
    .select()
    .from(booking)
    .where(eq(booking.stripeSessionId, stripeSessionId))
    .limit(1);
  if (!rows[0]) return null;
  return bookingDetail(db, rows[0]);
}

/** Paiement reçu : marque payé et lève l'expiration d'attente. Idempotent. */
export async function markBookingPaid(
  db: DbOrTx,
  bookingId: string,
  stripePaymentIntentId: string | null,
) {
  await db
    .update(booking)
    .set({
      paymentStatus: "paid",
      stripePaymentIntentId,
      pendingExpiresAt: null,
    })
    .where(eq(booking.id, bookingId));
}

/** Bascule un `pending` en `confirmed` (toutes les conditions remplies). */
export async function markBookingConfirmed(db: DbOrTx, bookingId: string) {
  await db
    .update(booking)
    .set({ status: "confirmed" })
    .where(eq(booking.id, bookingId));
}

/** Pendings expirés en attente de paiement (à annuler). */
export async function listExpiredPendings(db: DbOrTx, now: Date) {
  return db
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

export interface NewBooking {
  id: string;
  officeId: string;
  practitionerId: string;
  roomId: string;
  sessionTypeId: string;
  sessionNameSnapshot: string;
  durationMinSnapshot: number;
  bufferAfterMinSnapshot: number;
  startAt: Date;
  endAt: Date;
  patientFirstName: string;
  patientLastName: string;
  patientEmail: string;
  patientPhone?: string;
  notes?: string;
  cancelToken: string;
  rescheduleToken: string;
  status?: string;
  paymentStatus?: string;
  stripeSessionId?: string | null;
  validationRequired?: boolean;
  pendingExpiresAt?: Date | null;
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
export async function tryInsertBooking(
  db: DbOrTx,
  data: NewBooking,
): Promise<{ conflict: true } | { conflict: false; id: string }> {
  const start = data.startAt.getTime();
  const end = data.endAt.getTime() + data.bufferAfterMinSnapshot * 60_000;

  // Chevauchement praticien (toutes salles) OU salle (tous praticiens).
  const byPrac = await listActiveBookings(db, {
    practitionerId: data.practitionerId,
    from: data.startAt,
    to: data.endAt,
  });
  const byRoom = await listActiveBookings(db, {
    roomIds: [data.roomId],
    from: data.startAt,
    to: data.endAt,
  });
  const seen = new Map(byPrac.map((b) => [b.id, b]));
  for (const b of byRoom) seen.set(b.id, b);
  if ([...seen.values()].some((b) => collides(start, end, b))) {
    return { conflict: true as const };
  }
  const ids = await db
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
export async function tryMoveBooking(
  db: DbOrTx,
  bookingId: string,
  move: { startAt: Date; endAt: Date; roomId: string },
): Promise<boolean> {
  const rows = await db
    .select()
    .from(booking)
    .where(eq(booking.id, bookingId))
    .limit(1);
  const current = rows[0];
  if (!current || current.status !== "confirmed") return false;
  const start = move.startAt.getTime();
  const end = move.endAt.getTime() + current.bufferAfterMinSnapshot * 60_000;

  const byPrac = await listActiveBookings(db, {
    practitionerId: current.practitionerId,
    excludeBookingId: bookingId,
    from: move.startAt,
    to: move.endAt,
  });
  const byRoom = await listActiveBookings(db, {
    roomIds: [move.roomId],
    excludeBookingId: bookingId,
    from: move.startAt,
    to: move.endAt,
  });
  const seen = new Map(byPrac.map((b) => [b.id, b]));
  for (const b of byRoom) seen.set(b.id, b);
  if ([...seen.values()].some((b) => collides(start, end, b))) return false;

  await db
    .update(booking)
    .set({ startAt: move.startAt, endAt: move.endAt, roomId: move.roomId })
    .where(eq(booking.id, bookingId));
  return true;
}

export async function markBookingCancelled(
  db: DbOrTx,
  bookingId: string,
  reason: string | null,
  now: Date,
) {
  await db
    .update(booking)
    .set({ status: "cancelled", cancelledAt: now, cancelReason: reason })
    .where(eq(booking.id, bookingId));
}

export async function countFutureConfirmedByEmail(
  db: DbOrTx,
  practitionerId: string,
  email: string,
  now: Date,
): Promise<number> {
  const rows = await db
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

/** Salles d'un cabinet (pour la vue partagée / l'éditeur de dispos). */
export async function listRooms(db: DbOrTx, officeId: string) {
  return db.select().from(room).where(eq(room.officeId, officeId));
}

export async function getOfficeById(
  db: DbOrTx,
  officeId: string,
): Promise<Office | null> {
  const rows = await db
    .select()
    .from(office)
    .where(eq(office.id, officeId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getOfficeBySlug(
  db: DbOrTx,
  slug: string,
): Promise<Office | null> {
  const rows = await db
    .select()
    .from(office)
    .where(eq(office.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

/** Création complète d'un cabinet (office + membre + praticien). */
export async function createOffice(
  db: DbOrTx,
  data: {
    office: { id: string; name: string; slug: string; address: string | null };
    member: { id: string; officeId: string; userId: string; role: string };
    practitioner: {
      id: string;
      officeId: string;
      userId: string;
      displayName: string;
      slug: string;
    };
  },
) {
  await db.insert(office).values(data.office);
  await db.insert(member).values({ ...data.member, active: true });
  await db.insert(practitioner).values({ ...data.practitioner, active: true });
}

export async function getPractitionerById(
  db: DbOrTx,
  practitionerId: string,
): Promise<Practitioner | null> {
  const rows = await db
    .select()
    .from(practitioner)
    .where(eq(practitioner.id, practitionerId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPractitionerBySlug(
  db: DbOrTx,
  slug: string,
): Promise<Practitioner | null> {
  const rows = await db
    .select()
    .from(practitioner)
    .where(eq(practitioner.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPractitionerByUserId(
  db: DbOrTx,
  userId: string,
): Promise<Practitioner | null> {
  const rows = await db
    .select()
    .from(practitioner)
    .where(eq(practitioner.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getUserByEmail(
  db: DbOrTx,
  email: string,
): Promise<{ id: string; name: string; email: string } | null> {
  const rows = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  return rows[0] ?? null;
}

export async function getMembership(
  db: DbOrTx,
  officeId: string,
  userId: string,
) {
  const rows = await db
    .select()
    .from(member)
    .where(and(eq(member.officeId, officeId), eq(member.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listMemberships(db: DbOrTx, userId: string) {
  return db.select().from(member).where(eq(member.userId, userId));
}

export async function createInvite(
  db: DbOrTx,
  data: {
    id: string;
    officeId: string;
    email: string;
    role: string;
    token: string;
    expiresAt: Date;
    invitedByUserId: string;
  },
): Promise<string> {
  await db.insert(invite).values(data);
  return data.id;
}

export async function getInviteByToken(db: DbOrTx, token: string) {
  const rows = await db
    .select()
    .from(invite)
    .where(eq(invite.token, token))
    .limit(1);
  return rows[0] ?? null;
}

export async function listPendingInvites(db: DbOrTx, officeId: string) {
  return db
    .select()
    .from(invite)
    .where(and(eq(invite.officeId, officeId), isNull(invite.acceptedAt)));
}

/** Acceptation : membre + praticien créés, invitation marquée (sous mutex appelant). */
export async function acceptInvite(
  db: DbOrTx,
  data: {
    inviteId: string;
    now: Date;
    member: { id: string; officeId: string; userId: string; role: string };
    practitioner: {
      id: string;
      officeId: string;
      userId: string;
      displayName: string;
      slug: string;
    };
  },
) {
  await db.insert(member).values({ ...data.member, active: true });
  await db.insert(practitioner).values({ ...data.practitioner, active: true });
  await db
    .update(invite)
    .set({ acceptedAt: data.now })
    .where(eq(invite.id, data.inviteId));
}

export interface OfficePageData {
  office: Office;
  practitioners: { practitioner: Practitioner; sessionTypes: SessionType[] }[];
}

/** Page publique du cabinet : null si slug inconnu ou page désactivée. */
export async function getOfficePage(
  db: DbOrTx,
  slug: string,
): Promise<OfficePageData | null> {
  const officeRows = await db
    .select()
    .from(office)
    .where(eq(office.slug, slug))
    .limit(1);
  const off = officeRows[0];
  if (!off || !off.enableOfficePage) return null;
  const pracs = await db
    .select()
    .from(practitioner)
    .where(and(eq(practitioner.officeId, off.id), eq(practitioner.active, true)));
  const result: OfficePageData["practitioners"] = [];
  for (const prac of pracs) {
    const types = await db
      .select()
      .from(sessionType)
      .where(and(eq(sessionType.practitionerId, prac.id), eq(sessionType.active, true)));
    result.push({ practitioner: prac, sessionTypes: types });
  }
  return { office: off, practitioners: result };
}

// --- Rappels & clôture (cron) ---

export async function listRemindersDue(db: DbOrTx, now: Date) {
  // Le service filtre précisément par office.reminderHoursBefore ; ici on
  // présélectionne large (départ dans moins de 48h, rappel non envoyé).
  const horizon = new Date(now.getTime() + 48 * 3_600_000);
  const rows = await db
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

export async function markReminderSent(db: DbOrTx, bookingId: string, now: Date) {
  await db
    .update(booking)
    .set({ reminderSentAt: now })
    .where(eq(booking.id, bookingId));
}

/** Bascule les RDV passés en `completed`. Retourne le nombre de lignes. */
export async function completePastBookings(db: DbOrTx, now: Date): Promise<number> {
  const rows = await db
    .select({ id: booking.id })
    .from(booking)
    .where(and(eq(booking.status, "confirmed"), lt(booking.endAt, now)));
  for (const r of rows) {
    await db.update(booking).set({ status: "completed" }).where(eq(booking.id, r.id));
  }
  return rows.length;
}

// --- Gestion (tableau de bord) ---

/** Réservations d'un praticien sur une période (tous statuts, pour l'agenda). */
export async function listBookingsForPractitioner(
  db: DbOrTx,
  practitionerId: string,
  from: Date,
  to: Date,
) {
  return db
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
export async function listOfficeBookings(
  db: DbOrTx,
  officeId: string,
  from: Date,
  to: Date,
) {
  const rows = await db
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

export async function listPractitionersByOffice(db: DbOrTx, officeId: string) {
  return db
    .select()
    .from(practitioner)
    .where(and(eq(practitioner.officeId, officeId), eq(practitioner.active, true)));
}

export async function listSessionTypes(db: DbOrTx, practitionerId: string) {
  return db
    .select()
    .from(sessionType)
    .where(eq(sessionType.practitionerId, practitionerId));
}

export async function createSessionType(
  db: DbOrTx,
  data: {
    id: string;
    practitionerId: string;
    name: string;
    description: string | null;
    durationMin: number;
    bufferAfterMin: number;
    priceDisplay: string | null;
    requiresPayment?: boolean;
    priceCents?: number | null;
    requiresValidation?: boolean;
  },
) {
  await db.insert(sessionType).values({
    ...data,
    active: true,
    requiresPayment: data.requiresPayment ?? false,
    priceCents: data.priceCents ?? null,
    requiresValidation: data.requiresValidation ?? false,
  });
  return data.id;
}

export async function updateSessionType(
  db: DbOrTx,
  id: string,
  data: Partial<{
    name: string;
    description: string | null;
    durationMin: number;
    bufferAfterMin: number;
    priceDisplay: string | null;
    active: boolean;
    requiresPayment: boolean;
    priceCents: number | null;
    requiresValidation: boolean;
  }>,
) {
  await db.update(sessionType).set(data).where(eq(sessionType.id, id));
}

export async function deleteSessionType(db: DbOrTx, id: string) {
  await db.delete(sessionType).where(eq(sessionType.id, id));
}

export async function countFutureBookingsBySessionType(
  db: DbOrTx,
  sessionTypeId: string,
  now: Date,
): Promise<number> {
  const rows = await db
    .select({ id: booking.id })
    .from(booking)
    .where(
      and(
        eq(booking.sessionTypeId, sessionTypeId),
        eq(booking.status, "confirmed"),
        gte(booking.startAt, now),
      ),
    );
  return rows.length;
}

/** Remplace toutes les règles hebdo d'un praticien. */
export async function replaceAvailabilityRules(
  db: DbOrTx,
  practitionerId: string,
  rules: { id: string; weekday: number; startTime: string; endTime: string; roomId: string }[],
) {
  await db.delete(availabilityRule).where(eq(availabilityRule.practitionerId, practitionerId));
  for (const r of rules) {
    await db.insert(availabilityRule).values({ ...r, practitionerId });
  }
}

export async function createException(
  db: DbOrTx,
  data: {
    id: string;
    practitionerId: string;
    date: string;
    kind: string;
    startTime: string | null;
    endTime: string | null;
    fullDay: boolean;
    roomId: string | null;
    reason: string | null;
  },
) {
  await db.insert(exception).values(data);
  return data.id;
}

export async function deleteException(db: DbOrTx, id: string) {
  await db.delete(exception).where(eq(exception.id, id));
}

export async function listRoomsWithMembers(db: DbOrTx, officeId: string) {
  const rooms = await db.select().from(room).where(eq(room.officeId, officeId));
  const allMembers = await db.select().from(roomMember);
  const byRoom = new Map<string, string[]>();
  for (const m of allMembers) {
    if (!rooms.some((r) => r.id === m.roomId)) continue;
    const list = byRoom.get(m.roomId) ?? [];
    list.push(m.practitionerId);
    byRoom.set(m.roomId, list);
  }
  return rooms.map((r) => ({ room: r, practitionerIds: byRoom.get(r.id) ?? [] }));
}

export async function createRoom(
  db: DbOrTx,
  data: { id: string; officeId: string; name: string; color: string },
) {
  await db.insert(room).values(data);
  return data.id;
}

export async function updateRoom(
  db: DbOrTx,
  id: string,
  data: Partial<{ name: string; color: string }>,
) {
  await db.update(room).set(data).where(eq(room.id, id));
}

export async function replaceRoomMembers(db: DbOrTx, roomId: string, practitionerIds: string[]) {
  await db.delete(roomMember).where(eq(roomMember.roomId, roomId));
  for (const practitionerId of practitionerIds) {
    await db.insert(roomMember).values({ id: crypto.randomUUID(), roomId, practitionerId });
  }
}

export async function deleteRoom(db: DbOrTx, id: string) {
  await db.delete(room).where(eq(room.id, id));
}

export async function countFutureBookingsByRoom(
  db: DbOrTx,
  roomId: string,
  now: Date,
): Promise<number> {
  const rows = await db
    .select({ id: booking.id })
    .from(booking)
    .where(
      and(eq(booking.roomId, roomId), eq(booking.status, "confirmed"), gte(booking.startAt, now)),
    );
  return rows.length;
}

export async function updateOffice(
  db: DbOrTx,
  officeId: string,
  data: Partial<{
    name: string;
    address: string | null;
    enablePractitionerPages: boolean;
    enableOfficePage: boolean;
    bookingLeadTimeMin: number;
    cancelDeadlineHours: number;
    reminderHoursBefore: number;
    defaultBufferAfterMin: number;
  }>,
) {
  await db.update(office).set(data).where(eq(office.id, officeId));
}

export async function updatePractitioner(
  db: DbOrTx,
  practitionerId: string,
  data: Partial<{
    displayName: string;
    slug: string;
    bio: string | null;
    publicContact: string | null;
  }>,
) {
  await db.update(practitioner).set(data).where(eq(practitioner.id, practitionerId));
}

export async function listMembersWithUsers(db: DbOrTx, officeId: string) {
  const members = await db.select().from(member).where(eq(member.officeId, officeId));
  const result = [];
  for (const m of members) {
    const users = await db.select().from(user).where(eq(user.id, m.userId)).limit(1);
    result.push({ member: m, user: users[0] ?? null });
  }
  return result;
}
