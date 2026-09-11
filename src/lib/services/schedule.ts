import type { DbOrTx } from "@/dal/types";
import * as availabilityDal from "@/dal/availability";
import * as bookingsDal from "@/dal/bookings";
import * as membersDal from "@/dal/members";
import * as officesDal from "@/dal/offices";
import * as practitionersDal from "@/dal/practitioners";
import * as roomsDal from "@/dal/rooms";
import * as sessionTypesDal from "@/dal/session-types";
import { dateStrInTz } from "@/lib/timezone";

import type {
  CreateExceptionInput,
  DeleteExceptionInput,
  DeleteRoomInput,
  DeleteSessionTypeInput,
  ReplaceAvailabilityInput,
  Requester,
  SaveRoomInput,
  SaveSessionTypeInput,
  UpdateOfficeSettingsInput,
  UpdateProfileInput,
} from "@/lib/schemas/schedule";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "./errors";

/**
 * Service de paramétrage praticien : disponibilités, exceptions, types de
 * séances, profil. Chaque opération vérifie que le demandeur est le praticien
 * lui-même ou un owner du cabinet.
 *
 * Les formes d'entrée viennent de `@/lib/schemas/schedule` (source unique) ;
 * ici uniquement les règles métier (conflits, accès, cohérence).
 */

export interface ScheduleDeps {
  /** Override de connexion (tests) ou transaction. Absent = connexion partagée du DAL. */
  tx?: DbOrTx;
  now?: Date;
}

async function checkAccess(
  practitionerId: string,
  officeId: string,
  req: Requester,
  tx?: DbOrTx,
): Promise<void> {
  const prac = await practitionersDal.getPractitionerById(practitionerId, tx);
  if (!prac || prac.officeId !== officeId) throw new NotFoundError("Praticien introuvable");
  if (req.requesterIsOwner) {
    const m = await membersDal.getMembership(officeId, req.requesterUserId, tx);
    if (!m || m.role !== "owner" || !m.active) {
      throw new ForbiddenError("Action non autorisée");
    }
    return;
  }
  if (prac.userId !== req.requesterUserId) {
    throw new ForbiddenError("Action non autorisée");
  }
}

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Salles utilisables par le praticien : allowlist vide = toutes. */
async function assertRoomAllowed(
  officeId: string,
  practitionerId: string,
  roomId: string,
  tx?: DbOrTx,
): Promise<void> {
  const rooms = await roomsDal.listRoomsWithMembers(officeId, tx);
  const entry = rooms.find((r) => r.room.id === roomId);
  if (!entry) throw new ValidationError("Salle inconnue");
  if (entry.practitionerIds.length > 0 && !entry.practitionerIds.includes(practitionerId)) {
    throw new ValidationError("Salle non autorisée pour ce praticien");
  }
}

// --- Disponibilités ----------------------------------------------------------

export async function replaceAvailability(deps: ScheduleDeps, input: ReplaceAvailabilityInput): Promise<void> {
  await checkAccess(input.practitionerId, input.officeId, input, deps.tx);

  for (const r of input.rules) {
    if (toMinutes(r.startTime) >= toMinutes(r.endTime)) {
      throw new ValidationError("L'heure de fin doit être après le début");
    }
    await assertRoomAllowed(input.officeId, input.practitionerId, r.roomId, deps.tx);
  }
  // Chevauchements sur un même jour (bornes qui se touchent = OK).
  const byDay = new Map<number, { start: number; end: number }[]>();
  for (const r of input.rules) {
    const list = byDay.get(r.weekday) ?? [];
    const cur = { start: toMinutes(r.startTime), end: toMinutes(r.endTime) };
    if (list.some((o) => cur.start < o.end && o.start < cur.end)) {
      throw new ValidationError("Deux plages se chevauchent le même jour");
    }
    list.push(cur);
    byDay.set(r.weekday, list);
  }

  await availabilityDal.replaceAvailabilityRules(input.practitionerId,
    input.rules.map((r) => ({ id: crypto.randomUUID(), ...r })), deps.tx);
}

// --- Types de séances --------------------------------------------------------

export async function saveSessionType(deps: ScheduleDeps, input: SaveSessionTypeInput): Promise<string> {
  if (input.requiresPayment && !input.priceCents) {
    throw new ValidationError("Un prix (centimes) est requis pour une séance payante");
  }
  const { practitionerId, officeId } = input;
  await checkAccess(practitionerId, officeId, input, deps.tx);

  if (input.id) {
    const existing = (await sessionTypesDal.listSessionTypes(practitionerId, deps.tx)).find(
      (t) => t.id === input.id,
    );
    if (!existing) throw new NotFoundError("Type de séance introuvable");
    await sessionTypesDal.updateSessionType(input.id, {
      name: input.name,
      description: input.description ?? null,
      durationMin: input.durationMin,
      bufferAfterMin: input.bufferAfterMin,
      priceDisplay: input.priceDisplay || null,
      active: input.active ?? existing.active,
      requiresPayment: input.requiresPayment,
      priceCents: input.requiresPayment ? (input.priceCents ?? null) : null,
      requiresValidation: input.requiresValidation,
    }, deps.tx);
    return input.id;
  }
  return sessionTypesDal.createSessionType({
    id: crypto.randomUUID(),
    practitionerId,
    name: input.name,
    description: input.description ?? null,
    durationMin: input.durationMin,
    bufferAfterMin: input.bufferAfterMin,
    priceDisplay: input.priceDisplay || null,
    requiresPayment: input.requiresPayment,
    priceCents: input.requiresPayment ? (input.priceCents ?? null) : null,
    requiresValidation: input.requiresValidation,
  }, deps.tx);
}

export async function deleteSessionType(deps: ScheduleDeps, input: DeleteSessionTypeInput): Promise<void> {
  await checkAccess(input.practitionerId, input.officeId, input, deps.tx);
  const existing = (await sessionTypesDal.listSessionTypes(input.practitionerId, deps.tx)).find(
    (t) => t.id === input.id,
  );
  if (!existing) throw new NotFoundError("Type de séance introuvable");
  const future = await sessionTypesDal.countFutureBookingsBySessionType(input.id,
    deps.now ?? new Date(), deps.tx);
  if (future > 0) {
    throw new ValidationError(
      "Des réservations à venir utilisent ce type : désactivez-le plutôt que de le supprimer",
    );
  }
  await sessionTypesDal.deleteSessionType(input.id, deps.tx);
}

// --- Exceptions --------------------------------------------------------------

export async function createException(deps: ScheduleDeps, input: CreateExceptionInput): Promise<string> {
  const { practitionerId, officeId } = input;
  await checkAccess(practitionerId, officeId, input, deps.tx);

  if (!input.fullDay) {
    if (!input.startTime || !input.endTime) {
      throw new ValidationError("Heures de début et fin requises");
    }
    if (toMinutes(input.startTime) >= toMinutes(input.endTime)) {
      throw new ValidationError("L'heure de fin doit être après le début");
    }
  }
  if (input.kind === "extra") {
    if (!input.roomId) throw new ValidationError("Une salle est requise pour une ouverture");
    await assertRoomAllowed(officeId, practitionerId, input.roomId, deps.tx);
  }

  return availabilityDal.createException({
    id: crypto.randomUUID(),
    practitionerId,
    date: input.date,
    kind: input.kind,
    startTime: input.fullDay ? null : (input.startTime ?? null),
    endTime: input.fullDay ? null : (input.endTime ?? null),
    fullDay: input.fullDay,
    roomId: input.kind === "extra" ? (input.roomId ?? null) : null,
    reason: input.reason || null,
  }, deps.tx);
}

export async function deleteException(deps: ScheduleDeps, input: DeleteExceptionInput): Promise<void> {
  await checkAccess(input.practitionerId, input.officeId, input, deps.tx);
  await availabilityDal.deleteException(input.id, deps.tx);
}

// --- Profil ------------------------------------------------------------------

export async function updateProfile(deps: ScheduleDeps, input: UpdateProfileInput): Promise<void> {
  const { practitionerId } = input;
  await checkAccess(practitionerId, input.officeId, input, deps.tx);

  if (input.slug) {
    const taken = await practitionersDal.getPractitionerBySlug(input.slug, deps.tx);
    if (taken && taken.id !== practitionerId) {
      throw new ConflictError("Cet identifiant public est déjà pris");
    }
  }
  await practitionersDal.updatePractitioner(practitionerId, {
    displayName: input.displayName,
    ...(input.slug ? { slug: input.slug } : {}),
    bio: input.bio || null,
    publicContact: input.publicContact || null,
  }, deps.tx);
}

// --- Salles (owner) ----------------------------------------------------------

async function requireOwner(officeId: string, userId: string, tx?: DbOrTx): Promise<void> {
  const m = await membersDal.getMembership(officeId, userId, tx);
  if (!m || m.role !== "owner" || !m.active) {
    throw new ForbiddenError("Seul le responsable du cabinet peut gérer les salles");
  }
}

export async function saveRoom(deps: ScheduleDeps, input: SaveRoomInput): Promise<string> {
  await requireOwner(input.officeId, input.requesterUserId, deps.tx);

  const pracs = await practitionersDal.listPractitionersByOffice(input.officeId, deps.tx);
  const ids = new Set(pracs.map((p) => p.id));
  if (!input.practitionerIds.every((id) => ids.has(id))) {
    throw new ValidationError("Praticien inconnu dans ce cabinet");
  }

  if (input.id) {
    const rooms = await roomsDal.listRooms(input.officeId, deps.tx);
    if (!rooms.some((r) => r.id === input.id)) throw new NotFoundError("Salle introuvable");
    await roomsDal.updateRoom(input.id, { name: input.name, color: input.color }, deps.tx);
    await roomsDal.replaceRoomMembers(input.id, input.practitionerIds, deps.tx);
    return input.id;
  }
  const id = crypto.randomUUID();
  await roomsDal.createRoom({ id, officeId: input.officeId, name: input.name, color: input.color }, deps.tx);
  await roomsDal.replaceRoomMembers(id, input.practitionerIds, deps.tx);
  return id;
}

export async function deleteRoom(deps: ScheduleDeps, input: DeleteRoomInput): Promise<void> {
  await requireOwner(input.officeId, input.requesterUserId, deps.tx);
  const rooms = await roomsDal.listRooms(input.officeId, deps.tx);
  if (!rooms.some((r) => r.id === input.id)) throw new NotFoundError("Salle introuvable");
  const future = await roomsDal.countFutureBookingsByRoom(input.id, deps.now ?? new Date(), deps.tx);
  if (future > 0) {
    throw new ValidationError("Salle utilisée par des réservations à venir");
  }
  const rules = await availabilityDal.countRulesByRoom(input.id, deps.tx);
  if (rules > 0) {
    throw new ValidationError("Salle utilisée dans des disponibilités : retirez-la d'abord des plages");
  }
  await roomsDal.deleteRoom(input.id, deps.tx);
}

// --- Paramètres cabinet (owner) ----------------------------------------------

export async function updateOfficeSettings(deps: ScheduleDeps, input: UpdateOfficeSettingsInput): Promise<void> {
  await requireOwner(input.officeId, input.requesterUserId, deps.tx);
  const office = await officesDal.getOfficeById(input.officeId, deps.tx);
  if (!office) throw new NotFoundError("Cabinet introuvable");
  const data: Record<string, unknown> = { ...input };
  delete data.officeId;
  delete data.requesterUserId;
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) delete data[k];
    else if (v === "" && k === "address") data[k] = null;
  }
  if (Object.keys(data).length === 0) return;
  await officesDal.updateOffice(input.officeId, data as Parameters<typeof officesDal.updateOffice>[1], deps.tx);
}

// --- Lecture mois disponibilités (calendrier praticien) ---------------------

export interface AvailabilityMonthInput {
  userId: string;
  from: string; // "YYYY-MM-DD", validé par la route
  days: number; // borné par la route (1..62)
}

/** Données mensuelles : règles + exceptions + réservations + salles. */
export async function getAvailabilityMonth(deps: ScheduleDeps, input: AvailabilityMonthInput) {
  const prac = await practitionersDal.getPractitionerByUserId(input.userId, deps.tx);
  if (!prac) throw new NotFoundError("Praticien introuvable");
  const to = dateStrInTz(
    new Date(new Date(`${input.from}T12:00:00Z`).getTime() + input.days * 86_400_000),
    "Europe/Paris",
  );
  const [rules, exceptions, bookings, rooms] = await Promise.all([
    availabilityDal.listRules(prac.id, deps.tx),
    availabilityDal.listExceptions(prac.id, input.from, to, deps.tx),
    bookingsDal.listBookingsForPractitioner(
      prac.id,
      new Date(`${input.from}T00:00:00Z`),
      new Date(new Date(`${input.from}T00:00:00Z`).getTime() + (input.days + 1) * 86_400_000),
      deps.tx,
    ),
    roomsDal.listRooms(prac.officeId, deps.tx),
  ]);
  return {
    rules: rules.map((r) => ({
      weekday: r.weekday,
      startTime: r.startTime,
      endTime: r.endTime,
      roomId: r.roomId,
    })),
    exceptions: exceptions.map((x) => ({
      id: x.id,
      date: x.date,
      kind: x.kind,
      startTime: x.startTime,
      endTime: x.endTime,
      fullDay: x.fullDay,
      roomId: x.roomId,
      reason: x.reason,
    })),
    bookings: bookings
      .filter((b) => b.status !== "cancelled")
      .map((b) => ({
        id: b.id,
        startAt: b.startAt.toISOString(),
        endAt: b.endAt.toISOString(),
        status: b.status,
      })),
    rooms: rooms.map((r) => ({ id: r.id, name: r.name, color: r.color })),
  };
}
