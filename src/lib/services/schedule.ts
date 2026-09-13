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

/**
 * Autorisation praticien : résout l'office depuis le praticien (404 si
 * inconnu) puis autorise soi-même ou un owner actif du cabinet (403 sinon).
 * Les routes ne résolvent jamais ce périmètre elles-mêmes : elles transmettent
 * uniquement `requesterUserId` + l'identifiant de la ressource.
 */
async function checkAccess(
  practitionerId: string,
  requesterUserId: string,
): Promise<{ officeId: string }> {
  const prac = await practitionersDal.getPractitionerById(practitionerId);
  if (!prac) throw new NotFoundError("Praticien introuvable");
  if (prac.userId === requesterUserId && prac.active) return { officeId: prac.officeId };
  const m = await membersDal.getMembership(prac.officeId, requesterUserId);
  if (!m || m.role !== "owner" || !m.active) {
    throw new ForbiddenError("Action non autorisée");
  }
  return { officeId: prac.officeId };
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
): Promise<void> {
  const rooms = await roomsDal.listRoomsWithMembers(officeId);
  const entry = rooms.find((r) => r.room.id === roomId);
  if (!entry) throw new ValidationError("Salle inconnue");
  if (entry.practitionerIds.length > 0 && !entry.practitionerIds.includes(practitionerId)) {
    throw new ValidationError("Salle non autorisée pour ce praticien");
  }
}

// --- Disponibilités ----------------------------------------------------------

export async function replaceAvailability(input: ReplaceAvailabilityInput): Promise<void> {
  const { officeId } = await checkAccess(input.practitionerId, input.requesterUserId);

  for (const r of input.rules) {
    if (toMinutes(r.startTime) >= toMinutes(r.endTime)) {
      throw new ValidationError("L'heure de fin doit être après le début");
    }
    await assertRoomAllowed(officeId, input.practitionerId, r.roomId);
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
    input.rules.map((r) => ({ id: crypto.randomUUID(), ...r })));
}

// --- Types de séances --------------------------------------------------------

export async function saveSessionType(input: SaveSessionTypeInput): Promise<string> {
  if (input.requiresPayment && !input.priceCents) {
    throw new ValidationError("Un prix (centimes) est requis pour une séance payante");
  }
  const { practitionerId } = input;
  await checkAccess(practitionerId, input.requesterUserId);

  if (input.id) {
    const existing = (await sessionTypesDal.listSessionTypes(practitionerId)).find(
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
    });
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
  });
}

export async function deleteSessionType(input: DeleteSessionTypeInput, now: Date = new Date()): Promise<void> {
  await checkAccess(input.practitionerId, input.requesterUserId);
  const existing = (await sessionTypesDal.listSessionTypes(input.practitionerId)).find(
    (t) => t.id === input.id,
  );
  if (!existing) throw new NotFoundError("Type de séance introuvable");
  const future = await sessionTypesDal.countFutureBookingsBySessionType(input.id, now);
  if (future > 0) {
    throw new ValidationError(
      "Des réservations à venir utilisent ce type : désactivez-le plutôt que de le supprimer",
    );
  }
  await sessionTypesDal.deleteSessionType(input.id);
}

// --- Exceptions --------------------------------------------------------------

export async function createException(input: CreateExceptionInput): Promise<string> {
  const { practitionerId } = input;
  const { officeId } = await checkAccess(practitionerId, input.requesterUserId);

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
    await assertRoomAllowed(officeId, practitionerId, input.roomId);
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
  });
}

export async function deleteException(input: DeleteExceptionInput): Promise<void> {
  await checkAccess(input.practitionerId, input.requesterUserId);
  await availabilityDal.deleteException(input.id);
}

// --- Profil ------------------------------------------------------------------

export async function updateProfile(input: UpdateProfileInput): Promise<void> {
  const { practitionerId } = input;
  await checkAccess(practitionerId, input.requesterUserId);

  if (input.slug) {
    const taken = await practitionersDal.getPractitionerBySlug(input.slug);
    if (taken && taken.id !== practitionerId) {
      throw new ConflictError("Cet identifiant public est déjà pris");
    }
  }
  await practitionersDal.updatePractitioner(practitionerId, {
    displayName: input.displayName,
    ...(input.slug ? { slug: input.slug } : {}),
    bio: input.bio || null,
    publicContact: input.publicContact || null,
  });
}

// --- Salles (owner) ----------------------------------------------------------

async function requireOwner(officeId: string, userId: string): Promise<void> {
  const m = await membersDal.getMembership(officeId, userId);
  if (!m || m.role !== "owner" || !m.active) {
    throw new ForbiddenError("Seul le responsable du cabinet peut gérer les salles");
  }
}

export async function saveRoom(input: SaveRoomInput): Promise<string> {
  await requireOwner(input.officeId, input.requesterUserId);

  const pracs = await practitionersDal.listPractitionersByOffice(input.officeId);
  const ids = new Set(pracs.map((p) => p.id));
  if (!input.practitionerIds.every((id) => ids.has(id))) {
    throw new ValidationError("Praticien inconnu dans ce cabinet");
  }

  if (input.id) {
    const rooms = await roomsDal.listRooms(input.officeId);
    if (!rooms.some((r) => r.id === input.id)) throw new NotFoundError("Salle introuvable");
    await roomsDal.updateRoom(input.id, { name: input.name, color: input.color });
    await roomsDal.replaceRoomMembers(input.id, input.practitionerIds);
    return input.id;
  }
  const id = crypto.randomUUID();
  await roomsDal.createRoom({ id, officeId: input.officeId, name: input.name, color: input.color });
  await roomsDal.replaceRoomMembers(id, input.practitionerIds);
  return id;
}

export async function deleteRoom(input: DeleteRoomInput, now: Date = new Date()): Promise<void> {
  await requireOwner(input.officeId, input.requesterUserId);
  const rooms = await roomsDal.listRooms(input.officeId);
  if (!rooms.some((r) => r.id === input.id)) throw new NotFoundError("Salle introuvable");
  const future = await roomsDal.countFutureBookingsByRoom(input.id, now);
  if (future > 0) {
    throw new ValidationError("Salle utilisée par des réservations à venir");
  }
  const rules = await availabilityDal.countRulesByRoom(input.id);
  if (rules > 0) {
    throw new ValidationError("Salle utilisée dans des disponibilités : retirez-la d'abord des plages");
  }
  await roomsDal.deleteRoom(input.id);
}

// --- Paramètres cabinet (owner) ----------------------------------------------

export async function updateOfficeSettings(input: UpdateOfficeSettingsInput): Promise<void> {
  await requireOwner(input.officeId, input.requesterUserId);
  const office = await officesDal.getOfficeById(input.officeId);
  if (!office) throw new NotFoundError("Cabinet introuvable");

  // Patch explicite : seuls les champs fournis sont écrits (le schéma Zod a
  // déjà supprimé les clés inconnues et validé chaque type).
  const patch: Parameters<typeof officesDal.updateOffice>[1] = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.address !== undefined) patch.address = input.address || null;
  if (input.enablePractitionerPages !== undefined) {
    patch.enablePractitionerPages = input.enablePractitionerPages;
  }
  if (input.enableOfficePage !== undefined) patch.enableOfficePage = input.enableOfficePage;
  if (input.bookingLeadTimeMin !== undefined) patch.bookingLeadTimeMin = input.bookingLeadTimeMin;
  if (input.cancelDeadlineHours !== undefined) patch.cancelDeadlineHours = input.cancelDeadlineHours;
  if (input.reminderHoursBefore !== undefined) patch.reminderHoursBefore = input.reminderHoursBefore;
  if (input.defaultBufferAfterMin !== undefined) {
    patch.defaultBufferAfterMin = input.defaultBufferAfterMin;
  }
  if (Object.keys(patch).length === 0) return;
  await officesDal.updateOffice(input.officeId, patch);
}

// --- Lecture mois disponibilités (calendrier praticien) ---------------------

export interface AvailabilityMonthInput {
  userId: string;
  from: string; // "YYYY-MM-DD", validé par la route
  days: number; // borné par la route (1..62)
}

/** Données mensuelles : règles + exceptions + réservations + salles. */
export async function getAvailabilityMonth(input: AvailabilityMonthInput) {
  const prac = await practitionersDal.getPractitionerByUserId(input.userId);
  if (!prac || !prac.active) throw new NotFoundError("Praticien introuvable");
  const to = dateStrInTz(
    new Date(new Date(`${input.from}T12:00:00Z`).getTime() + input.days * 86_400_000),
    "Europe/Paris",
  );
  const [rules, exceptions, bookings, rooms] = await Promise.all([
    availabilityDal.listRules(prac.id),
    availabilityDal.listExceptions(prac.id, input.from, to),
    bookingsDal.listBookingsForPractitioner(
      prac.id,
      new Date(`${input.from}T00:00:00Z`),
      new Date(new Date(`${input.from}T00:00:00Z`).getTime() + (input.days + 1) * 86_400_000),
    ),
    roomsDal.listRooms(prac.officeId),
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
