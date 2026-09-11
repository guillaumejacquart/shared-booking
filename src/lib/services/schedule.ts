import type { Db } from "@/dal/types";
import * as store from "@/dal/store";
import {
  createExceptionSchema,
  deleteExceptionSchema,
  deleteRoomSchema,
  deleteSessionTypeSchema,
  replaceAvailabilitySchema,
  saveRoomSchema,
  saveSessionTypeSchema,
  updateOfficeSettingsSchema,
  updateProfileSchema,
  type CreateExceptionInput,
  type DeleteExceptionInput,
  type DeleteRoomInput,
  type DeleteSessionTypeInput,
  type ReplaceAvailabilityInput,
  type Requester,
  type SaveRoomInput,
  type SaveSessionTypeInput,
  type UpdateOfficeSettingsInput,
  type UpdateProfileInput,
} from "@/lib/schemas/schedule";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  validationError,
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
  db: Db;
  now?: Date;
}

async function checkAccess(
  db: Db,
  practitionerId: string,
  officeId: string,
  req: Requester,
): Promise<void> {
  const prac = await store.getPractitionerById(db, practitionerId);
  if (!prac || prac.officeId !== officeId) throw new NotFoundError("Praticien introuvable");
  if (req.requesterIsOwner) {
    const m = await store.getMembership(db, officeId, req.requesterUserId);
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
  db: Db,
  officeId: string,
  practitionerId: string,
  roomId: string,
): Promise<void> {
  const rooms = await store.listRoomsWithMembers(db, officeId);
  const entry = rooms.find((r) => r.room.id === roomId);
  if (!entry) throw new ValidationError("Salle inconnue");
  if (entry.practitionerIds.length > 0 && !entry.practitionerIds.includes(practitionerId)) {
    throw new ValidationError("Salle non autorisée pour ce praticien");
  }
}

// --- Disponibilités ----------------------------------------------------------

export async function replaceAvailability(deps: ScheduleDeps, input: ReplaceAvailabilityInput): Promise<void> {
  await checkAccess(deps.db, input.practitionerId, input.officeId, input);

  for (const r of input.rules) {
    if (toMinutes(r.startTime) >= toMinutes(r.endTime)) {
      throw new ValidationError("L'heure de fin doit être après le début");
    }
    await assertRoomAllowed(deps.db, input.officeId, input.practitionerId, r.roomId);
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

  await store.replaceAvailabilityRules(
    deps.db,
    input.practitionerId,
    input.rules.map((r) => ({ id: crypto.randomUUID(), ...r })),
  );
}

// --- Types de séances --------------------------------------------------------

export async function saveSessionType(deps: ScheduleDeps, input: SaveSessionTypeInput): Promise<string> {
  if (input.requiresPayment && !input.priceCents) {
    throw new ValidationError("Un prix (centimes) est requis pour une séance payante");
  }
  const { practitionerId, officeId } = input;
  await checkAccess(deps.db, practitionerId, officeId, input);

  if (input.id) {
    const existing = (await store.listSessionTypes(deps.db, practitionerId)).find(
      (t) => t.id === input.id,
    );
    if (!existing) throw new NotFoundError("Type de séance introuvable");
    await store.updateSessionType(deps.db, input.id, {
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
  return store.createSessionType(deps.db, {
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

export async function deleteSessionType(deps: ScheduleDeps, input: DeleteSessionTypeInput): Promise<void> {
  await checkAccess(deps.db, input.practitionerId, input.officeId, input);
  const existing = (await store.listSessionTypes(deps.db, input.practitionerId)).find(
    (t) => t.id === input.id,
  );
  if (!existing) throw new NotFoundError("Type de séance introuvable");
  const future = await store.countFutureBookingsBySessionType(
    deps.db,
    input.id,
    deps.now ?? new Date(),
  );
  if (future > 0) {
    throw new ValidationError(
      "Des réservations à venir utilisent ce type : désactivez-le plutôt que de le supprimer",
    );
  }
  await store.deleteSessionType(deps.db, input.id);
}

// --- Exceptions --------------------------------------------------------------

export async function createException(deps: ScheduleDeps, input: CreateExceptionInput): Promise<string> {
  const { practitionerId, officeId } = input;
  await checkAccess(deps.db, practitionerId, officeId, input);

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
    await assertRoomAllowed(deps.db, officeId, practitionerId, input.roomId);
  }

  return store.createException(deps.db, {
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

export async function deleteException(deps: ScheduleDeps, input: DeleteExceptionInput): Promise<void> {
  await checkAccess(deps.db, input.practitionerId, input.officeId, input);
  await store.deleteException(deps.db, input.id);
}

// --- Profil ------------------------------------------------------------------

export async function updateProfile(deps: ScheduleDeps, input: UpdateProfileInput): Promise<void> {
  const { practitionerId } = input;
  await checkAccess(deps.db, practitionerId, input.officeId, input);

  if (input.slug) {
    const taken = await store.getPractitionerBySlug(deps.db, input.slug);
    if (taken && taken.id !== practitionerId) {
      throw new ConflictError("Cet identifiant public est déjà pris");
    }
  }
  await store.updatePractitioner(deps.db, practitionerId, {
    displayName: input.displayName,
    ...(input.slug ? { slug: input.slug } : {}),
    bio: input.bio || null,
    publicContact: input.publicContact || null,
  });
}

// --- Salles (owner) ----------------------------------------------------------

async function requireOwner(db: Db, officeId: string, userId: string): Promise<void> {
  const m = await store.getMembership(db, officeId, userId);
  if (!m || m.role !== "owner" || !m.active) {
    throw new ForbiddenError("Seul le responsable du cabinet peut gérer les salles");
  }
}

export async function saveRoom(deps: ScheduleDeps, input: SaveRoomInput): Promise<string> {
  await requireOwner(deps.db, input.officeId, input.requesterUserId);

  const pracs = await store.listPractitionersByOffice(deps.db, input.officeId);
  const ids = new Set(pracs.map((p) => p.id));
  if (!input.practitionerIds.every((id) => ids.has(id))) {
    throw new ValidationError("Praticien inconnu dans ce cabinet");
  }

  if (input.id) {
    const rooms = await store.listRooms(deps.db, input.officeId);
    if (!rooms.some((r) => r.id === input.id)) throw new NotFoundError("Salle introuvable");
    await store.updateRoom(deps.db, input.id, { name: input.name, color: input.color });
    await store.replaceRoomMembers(deps.db, input.id, input.practitionerIds);
    return input.id;
  }
  const id = crypto.randomUUID();
  await store.createRoom(deps.db, { id, officeId: input.officeId, name: input.name, color: input.color });
  await store.replaceRoomMembers(deps.db, id, input.practitionerIds);
  return id;
}

export async function deleteRoom(deps: ScheduleDeps, input: DeleteRoomInput): Promise<void> {
  await requireOwner(deps.db, input.officeId, input.requesterUserId);
  const rooms = await store.listRooms(deps.db, input.officeId);
  if (!rooms.some((r) => r.id === input.id)) throw new NotFoundError("Salle introuvable");
  const future = await store.countFutureBookingsByRoom(deps.db, input.id, deps.now ?? new Date());
  if (future > 0) {
    throw new ValidationError("Salle utilisée par des réservations à venir");
  }
  const rules = await store.countRulesByRoom(deps.db, input.id);
  if (rules > 0) {
    throw new ValidationError("Salle utilisée dans des disponibilités : retirez-la d'abord des plages");
  }
  await store.deleteRoom(deps.db, input.id);
}

// --- Paramètres cabinet (owner) ----------------------------------------------

export async function updateOfficeSettings(deps: ScheduleDeps, input: UpdateOfficeSettingsInput): Promise<void> {
  await requireOwner(deps.db, input.officeId, input.requesterUserId);
  const office = await store.getOfficeById(deps.db, input.officeId);
  if (!office) throw new NotFoundError("Cabinet introuvable");
  const data: Record<string, unknown> = { ...input };
  delete data.officeId;
  delete data.requesterUserId;
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) delete data[k];
    else if (v === "" && k === "address") data[k] = null;
  }
  if (Object.keys(data).length === 0) return;
  await store.updateOffice(deps.db, input.officeId, data as Parameters<typeof store.updateOffice>[2]);
}
