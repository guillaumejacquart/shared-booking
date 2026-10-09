import * as availabilityDal from "@/dal/availability";
import * as bookingsDal from "@/dal/bookings";
import * as membersDal from "@/dal/members";
import * as officesDal from "@/dal/offices";
import * as practitionersDal from "@/dal/practitioners";
import * as roomsDal from "@/dal/rooms";
import * as sessionTypesDal from "@/dal/session-types";
import type { Ports } from "@/lib/ports";
import { ANALYTICS_EVENTS } from "@/lib/analytics";
import { sortRooms } from "@/services/room-order";
import { dateStrInTz } from "@/lib/timezone";
import type { SessionTypeVariant } from "@/dal/types";

import type {
  CreateExceptionInput,
  DeleteExceptionInput,
  DeleteRoomInput,
  DeleteSessionTypeInput,
  ReplaceAvailabilityInput,
  SaveRoomInput,
  SaveSessionTypeInput,
  UpdateOfficeSettingsInput,
  UpdatePractitionerSettingsInput,
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
  const membership = await membersDal.getMembership(prac.officeId, requesterUserId);
  if (!membership || membership.role !== "owner" || !membership.active) {
    throw new ForbiddenError("Action non autorisée");
  }
  return { officeId: prac.officeId };
}

function toMinutes(hhmm: string): number {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) throw new ValidationError("Heure invalide (HH:MM attendu)");
  const [hours, minutes] = hhmm.split(":").map(Number);
  if (hours > 23 || minutes > 59) throw new ValidationError("Heure invalide (HH:MM attendu)");
  return hours * 60 + minutes;
}

/** Salles utilisables par le praticien : allowlist vide = toutes. */
async function assertRoomAllowed(
  rooms: Awaited<ReturnType<typeof roomsDal.listRoomsWithMembers>>,
  practitionerId: string,
  roomId: string,
): Promise<void> {
  const entry = rooms.find((entry) => entry.room.id === roomId);
  if (!entry) throw new ValidationError("Salle inconnue");
  if (entry.practitionerIds.length > 0 && !entry.practitionerIds.includes(practitionerId)) {
    throw new ValidationError("Salle non autorisée pour ce praticien");
  }
}

/** Payload commun création / mise à jour d'un type de séance (niveau groupe). */
function buildSessionTypePayload(input: SaveSessionTypeInput) {
  return {
    name: input.name,
    description: input.description ?? null,
    requiresPayment: input.requiresPayment,
    requiresValidation: input.requiresValidation,
  };
}

/** Payload d'une déclinaison (le prix débité n'existe qu'en payant). */
function buildVariantPayload(
  input: SaveSessionTypeInput,
  variant: SaveSessionTypeInput["variants"][number],
  sortOrder: number,
) {
  return {
    durationMin: variant.durationMin,
    bufferAfterMin: variant.bufferAfterMin,
    priceDisplay: variant.priceDisplay,
    priceCents: input.requiresPayment ? (variant.priceCents ?? null) : null,
    sortOrder,
  };
}

/** Durées distinctes + prix affiché requis sur chaque déclinaison (payante ou non). */
function assertValidVariants(input: SaveSessionTypeInput): void {
  const durations = input.variants.map((variant) => variant.durationMin);
  if (new Set(durations).size !== durations.length) {
    throw new ValidationError("Deux déclinaisons ont la même durée");
  }
  for (const variant of input.variants) {
    if (!variant.priceDisplay?.trim()) {
      throw new ValidationError("Un prix affiché est requis pour chaque déclinaison (0 si tarif à définir)");
    }
  }
  if (input.requiresPayment) {
    for (const variant of input.variants) {
      if (!variant.priceCents) {
        throw new ValidationError(
          "Un prix (centimes) est requis pour chaque déclinaison d'une séance payante",
        );
      }
    }
  }
}

// --- Disponibilités ----------------------------------------------------------

export async function replaceAvailability(input: ReplaceAvailabilityInput): Promise<void> {
  await checkAccess(input.practitionerId, input.requesterUserId);

  for (const rule of input.rules) {
    if (toMinutes(rule.startTime) >= toMinutes(rule.endTime)) {
      throw new ValidationError("L'heure de fin doit être après le début");
    }
  }
  // Chevauchements sur un même jour (bornes qui se touchent = OK).
  const byDay = new Map<number, { start: number; end: number }[]>();
  for (const rule of input.rules) {
    const list = byDay.get(rule.weekday) ?? [];
    const cur = { start: toMinutes(rule.startTime), end: toMinutes(rule.endTime) };
    if (list.some((other) => cur.start < other.end && other.start < cur.end)) {
      throw new ValidationError("Deux plages se chevauchent le même jour");
    }
    list.push(cur);
    byDay.set(rule.weekday, list);
  }

  await availabilityDal.replaceAvailabilityRules(input.practitionerId,
    input.rules.map((rule) => ({ id: crypto.randomUUID(), ...rule })));
}

// --- Types de séances --------------------------------------------------------

export async function saveSessionType(
  ports: Ports,
  input: SaveSessionTypeInput,
): Promise<{ id: string; variants: SessionTypeVariant[] }> {
  assertValidVariants(input);
  const { practitionerId } = input;
  const { officeId } = await checkAccess(practitionerId, input.requesterUserId);

  // Salles compatibles : doivent exister et être utilisables par le praticien.
  // Chargées une seule fois (pas de requête par salle).
  const compatibleRoomIds = [...new Set(input.compatibleRoomIds ?? [])];
  const roomsWithMembers = await roomsDal.listRoomsWithMembers(officeId);
  for (const roomId of compatibleRoomIds) {
    await assertRoomAllowed(roomsWithMembers, practitionerId, roomId);
  }

  if (input.id) {
    const existing = (await sessionTypesDal.listSessionTypes(practitionerId)).find(
      (sessionType) => sessionType.id === input.id,
    );
    if (!existing) throw new NotFoundError("Type de séance introuvable");
    await sessionTypesDal.updateSessionType(input.id, {
      ...buildSessionTypePayload(input),
      active: input.active ?? existing.active,
    });
    await reconcileVariants(ports, input.id, input);
    await sessionTypesDal.replaceCompatibleRooms(input.id, compatibleRoomIds);
    return { id: input.id, variants: await sessionTypesDal.listVariants(input.id) };
  }
  const id = crypto.randomUUID();
  await sessionTypesDal.createSessionType({
    id,
    practitionerId,
    ...buildSessionTypePayload(input),
  });
  for (const [index, variant] of input.variants.entries()) {
    await sessionTypesDal.createVariant({
      id: crypto.randomUUID(),
      sessionTypeId: id,
      ...buildVariantPayload(input, variant, index),
    });
  }
  await sessionTypesDal.replaceCompatibleRooms(id, compatibleRoomIds);
  // Création uniquement : les mises à jour (même carte sauvegardée)
  // n'émettent rien pour ne pas bruiter le funnel activation.
  await ports.analytics.track(ANALYTICS_EVENTS.SESSION_TYPE_CREATED, {
    requiresPayment: input.requiresPayment,
    requiresValidation: input.requiresValidation,
    variantCount: input.variants.length,
  });
  return { id, variants: await sessionTypesDal.listVariants(id) };
}

/**
 * Réconcilie les déclinaisons : met à jour celles qui ont un id connu, crée
 * les nouvelles, supprime les retirées (refusé si une déclinaison retirée
 * porte des réservations à venir — comme pour la suppression d'un type).
 */
async function reconcileVariants(ports: Ports, sessionTypeId: string, input: SaveSessionTypeInput): Promise<void> {
  const now = ports.clock.now();
  const existing = await sessionTypesDal.listVariants(sessionTypeId);
  const knownIds = new Set(existing.map((variant) => variant.id));
  const wantedIds = new Set(
    input.variants.map((variant) => variant.id).filter((id): id is string => !!id),
  );
  for (const variant of existing) {
    if (!wantedIds.has(variant.id)) {
      const future = await sessionTypesDal.countFutureBookingsByVariant(variant.id, now);
      if (future > 0) {
        throw new ValidationError(
          "Une déclinaison supprimée est utilisée par des réservations à venir",
        );
      }
      await sessionTypesDal.deleteVariant(variant.id);
    }
  }
  for (const [index, variant] of input.variants.entries()) {
    if (variant.id && knownIds.has(variant.id)) {
      await sessionTypesDal.updateVariant(variant.id, buildVariantPayload(input, variant, index));
    } else {
      await sessionTypesDal.createVariant({
        id: crypto.randomUUID(),
        sessionTypeId,
        ...buildVariantPayload(input, variant, index),
      });
    }
  }
}

export async function deleteSessionType(ports: Ports, input: DeleteSessionTypeInput): Promise<void> {
  const now = ports.clock.now();
  await checkAccess(input.practitionerId, input.requesterUserId);
  const existing = (await sessionTypesDal.listSessionTypes(input.practitionerId)).find(
    (sessionType) => sessionType.id === input.id,
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

/** Contraintes de saisie d'une exception (horaires cohérents, salle si ouverture). */
async function assertValidException(
  input: CreateExceptionInput,
  officeId: string,
  practitionerId: string,
): Promise<void> {
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
    const rooms = await roomsDal.listRoomsWithMembers(officeId);
    await assertRoomAllowed(rooms, practitionerId, input.roomId);
  }
}

export async function createException(input: CreateExceptionInput): Promise<string> {
  const { practitionerId } = input;
  const { officeId } = await checkAccess(practitionerId, input.requesterUserId);
  await assertValidException(input, officeId, practitionerId);

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
    ...(input.slotStepMin !== undefined ? { slotStepMin: input.slotStepMin } : {}),
    ...(input.requiresValidationDefault !== undefined
      ? { requiresValidationDefault: input.requiresValidationDefault }
      : {}),
  });
}

/** Paramètres praticien (onglet dédié) : n'écrit que les champs fournis. */
export async function updatePractitionerSettings(input: UpdatePractitionerSettingsInput): Promise<void> {
  const { practitionerId } = input;
  await checkAccess(practitionerId, input.requesterUserId);
  await practitionersDal.updatePractitioner(practitionerId, {
    ...(input.slotStepMin !== undefined ? { slotStepMin: input.slotStepMin } : {}),
    ...(input.requiresValidationDefault !== undefined
      ? { requiresValidationDefault: input.requiresValidationDefault }
      : {}),
    // Moyens sur place : JSON dédupliqué (l'ordre canonique est
    // rétabli à la lecture par `parseOnsitePaymentMethods`).
    ...(input.onsitePaymentMethods !== undefined
      ? { onsitePaymentMethods: JSON.stringify([...new Set(input.onsitePaymentMethods)]) }
      : {}),
    ...(input.onsitePaymentNote !== undefined
      ? { onsitePaymentNote: input.onsitePaymentNote || null }
      : {}),
  });
}

// --- Salles (owner) ----------------------------------------------------------

async function requireOwner(officeId: string, userId: string): Promise<void> {
  const membership = await membersDal.getMembership(officeId, userId);
  if (!membership || membership.role !== "owner" || !membership.active) {
    throw new ForbiddenError("Seul le responsable du cabinet peut gérer les salles");
  }
}

export async function saveRoom(ports: Ports, input: SaveRoomInput): Promise<string> {
  await requireOwner(input.officeId, input.requesterUserId);

  const pracs = await practitionersDal.listPractitionersByOffice(input.officeId);
  const ids = new Set(pracs.map((prac) => prac.id));
  if (!input.practitionerIds.every((id) => ids.has(id))) {
    throw new ValidationError("Praticien inconnu dans ce cabinet");
  }

  if (input.id) {
    const rooms = await roomsDal.listRooms(input.officeId);
    if (!rooms.some((room) => room.id === input.id)) throw new NotFoundError("Salle introuvable");
    await roomsDal.updateRoom(input.id, { name: input.name, color: input.color });
    await roomsDal.replaceRoomMembers(input.id, input.practitionerIds);
    return input.id;
  }
  const id = crypto.randomUUID();
  await roomsDal.createRoom({ id, officeId: input.officeId, name: input.name, color: input.color });
  await roomsDal.replaceRoomMembers(id, input.practitionerIds);
  // Création uniquement : les renommages/recolorations n'émettent rien
  // (même règle que `session-type-created`).
  await ports.analytics.track(ANALYTICS_EVENTS.ROOM_CREATED, {
    practitionerCount: input.practitionerIds.length,
  });
  return id;
}

export async function deleteRoom(ports: Ports, input: DeleteRoomInput): Promise<void> {
  const now = ports.clock.now();
  await requireOwner(input.officeId, input.requesterUserId);
  const rooms = await roomsDal.listRooms(input.officeId);
  if (!rooms.some((room) => room.id === input.id)) throw new NotFoundError("Salle introuvable");
  const future = await roomsDal.countFutureBookingsByRoom(input.id, now);
  if (future > 0) {
    throw new ValidationError("Salle utilisée par des réservations à venir");
  }
  const sessionTypes = await sessionTypesDal.countSessionTypesByRoom(input.id);
  if (sessionTypes > 0) {
    throw new ValidationError("Salle requise par des types de séance : retirez-la d'abord");
  }
  await roomsDal.deleteRoom(input.id);
}

// --- Paramètres cabinet (owner) ----------------------------------------------

/**
 * Patch cabinet : seuls les champs fournis sont écrits (le schéma Zod a déjà
 * supprimé les clés inconnues et validé chaque type).
 */
function buildOfficePatch(
  input: UpdateOfficeSettingsInput,
): Parameters<typeof officesDal.updateOffice>[1] {
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
  if (input.themePalette !== undefined) patch.themePalette = input.themePalette;
  if (input.themeMode !== undefined) patch.themeMode = input.themeMode;
  return patch;
}

export async function updateOfficeSettings(input: UpdateOfficeSettingsInput): Promise<void> {
  await requireOwner(input.officeId, input.requesterUserId);
  const office = await officesDal.getOfficeById(input.officeId);
  if (!office) throw new NotFoundError("Cabinet introuvable");
  const patch = buildOfficePatch(input);
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
  const office = await officesDal.getOfficeById(prac.officeId);
  const timezone = office?.timezone ?? "Europe/Paris";
  const fromDate = new Date(`${input.from}T12:00:00Z`);
  if (Number.isNaN(fromDate.getTime())) throw new ValidationError("Date invalide");
  const to = dateStrInTz(
    new Date(fromDate.getTime() + input.days * 86_400_000),
    timezone,
  );
  const rangeStart = new Date(`${input.from}T00:00:00Z`);
  if (Number.isNaN(rangeStart.getTime())) throw new ValidationError("Date invalide");
  const [rules, exceptions, bookings, roomsWithMembers] = await Promise.all([
    availabilityDal.listRules(prac.id),
    availabilityDal.listExceptions(prac.id, input.from, to),
    bookingsDal.listBookingsForPractitioner(
      prac.id,
      rangeStart,
      new Date(rangeStart.getTime() + (input.days + 1) * 86_400_000),
    ),
    roomsDal.listRoomsWithMembers(prac.officeId),
  ]);
  return {
    rules: rules.map((rule) => ({
      weekday: rule.weekday,
      startTime: rule.startTime,
      endTime: rule.endTime,
    })),
    exceptions: exceptions.map((exception) => ({
      id: exception.id,
      date: exception.date,
      kind: exception.kind,
      startTime: exception.startTime,
      endTime: exception.endTime,
      fullDay: exception.fullDay,
      roomId: exception.roomId,
      reason: exception.reason,
    })),
    bookings: bookings
      .filter((booking) => booking.status !== "cancelled")
      .map((booking) => ({
        id: booking.id,
        startAt: booking.startAt.toISOString(),
        endAt: booking.endAt.toISOString(),
        status: booking.status,
      })),
    // Salles utilisables par le praticien uniquement (allowlist vide = toutes),
    // comme sur la page profil : le formulaire d'ouverture exceptionnelle ne
    // doit pas proposer de salle interdite (l'API la refuserait de toute façon).
    rooms: sortRooms(
      roomsWithMembers.filter(
        (entry) => entry.practitionerIds.length === 0 || entry.practitionerIds.includes(prac.id),
      ),
    ).map((entry) => ({ id: entry.room.id, name: entry.room.name, color: entry.room.color })),
  };
}

/** Surface du service paramétrage (utilisée par les routes via le container). */
export interface ScheduleService {
  replaceAvailability: typeof replaceAvailability;
  saveSessionType(input: SaveSessionTypeInput): ReturnType<typeof saveSessionType>;
  deleteSessionType(input: DeleteSessionTypeInput): ReturnType<typeof deleteSessionType>;
  createException: typeof createException;
  deleteException: typeof deleteException;
  updateProfile: typeof updateProfile;
  updatePractitionerSettings: typeof updatePractitionerSettings;
  saveRoom(input: SaveRoomInput): ReturnType<typeof saveRoom>;
  deleteRoom(input: DeleteRoomInput): ReturnType<typeof deleteRoom>;
  updateOfficeSettings: typeof updateOfficeSettings;
  getAvailabilityMonth: typeof getAvailabilityMonth;
}

export function createScheduleService(ports: Ports): ScheduleService {
  return {
    replaceAvailability,
    saveSessionType: (input) => saveSessionType(ports, input),
    deleteSessionType: (input) => deleteSessionType(ports, input),
    createException,
    deleteException,
    updateProfile,
    updatePractitionerSettings,
    saveRoom: (input) => saveRoom(ports, input),
    deleteRoom: (input) => deleteRoom(ports, input),
    updateOfficeSettings,
    getAvailabilityMonth,
  };
}
