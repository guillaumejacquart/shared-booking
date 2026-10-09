import * as bookingsDal from "@/dal/bookings";
import * as practitionersDal from "@/dal/practitioners";
import * as roomsDal from "@/dal/rooms";
import * as sessionTypesDal from "@/dal/session-types";
import type { Ports } from "@/lib/ports";
import type { ApiCreateBookingInput } from "@/lib/schemas/api-tokens";
import type { BookingResult } from "@/lib/schemas/bookings";
import { allowedRoomIdsFor } from "@/services/room-order";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { createManualBooking, findFirstFreeRoom } from "./manual";
import { cancelBooking } from "./manage";
import { resolveVariant } from "./slots";

/**
 * Façade API v1 (clés personnelles) : même sémantique que la saisie
 * manuelle (confirmé direct, email au patient, origine `api`), avec la
 * salle auto-assignée quand l'appelant n'en choisit pas.
 */

export interface ApiCreateInput extends ApiCreateBookingInput {
  practitionerId: string;
}

async function requireActivePractitioner(practitionerId: string) {
  const practitioner = await practitionersDal.getPractitionerById(practitionerId);
  if (!practitioner || !practitioner.active) {
    throw new NotFoundError("Praticien introuvable");
  }
  return practitioner;
}

export async function createApiBooking(
  ports: Ports,
  input: ApiCreateInput,
): Promise<BookingResult> {
  const practitioner = await requireActivePractitioner(input.practitionerId);
  if (input.roomId) {
    return createManualBooking(ports, {
      requesterUserId: practitioner.userId,
      sessionTypeId: input.sessionTypeId,
      sessionVariantId: input.sessionVariantId,
      startAt: input.startAt,
      roomId: input.roomId,
      patientFirstName: input.patientFirstName,
      patientLastName: input.patientLastName,
      patientEmail: input.patientEmail,
      patientPhone: input.patientPhone,
      notes: input.notes,
      overrideOff: input.overrideOff,
      origin: "api",
    });
  }
  const sessionTypes = await sessionTypesDal.listSessionTypes(practitioner.id);
  const sessionType = sessionTypes.find(
    (entry) => entry.id === input.sessionTypeId && entry.active,
  );
  if (!sessionType) throw new NotFoundError("Type de séance introuvable");
  const variants = await sessionTypesDal.listVariants(sessionType.id);
  const variant = resolveVariant({ ...sessionType, variants }, input.sessionVariantId);
  const start = new Date(input.startAt);
  if (Number.isNaN(start.getTime())) {
    throw new ValidationError("Horaire invalide");
  }
  const end = new Date(start.getTime() + variant.durationMin * 60_000);
  const compatibleRoomIds =
    await sessionTypesDal.listCompatibleRoomIds(sessionType.id);
  const roomId = await findFirstFreeRoom({
    practitionerId: practitioner.id,
    officeId: practitioner.officeId,
    compatibleRoomIds,
    start,
    end,
    bufferAfterMin: variant.bufferAfterMin,
  });
  if (!roomId) throw new ConflictError("Aucune salle libre à cet horaire");
  return createManualBooking(ports, {
    requesterUserId: practitioner.userId,
    sessionTypeId: input.sessionTypeId,
    sessionVariantId: input.sessionVariantId,
    startAt: input.startAt,
    roomId,
    patientFirstName: input.patientFirstName,
    patientLastName: input.patientLastName,
    patientEmail: input.patientEmail,
    patientPhone: input.patientPhone,
    notes: input.notes,
    overrideOff: input.overrideOff,
    origin: "api",
  });
}

export interface ApiCancelInput {
  practitionerId: string;
  bookingId: string;
  reason?: string;
}

/** Annulation praticien via clé : le RDV doit appartenir au porteur du token. */
export async function cancelApiBooking(
  ports: Ports,
  input: ApiCancelInput,
): Promise<{ id: string; status: string }> {
  const row = await bookingsDal.getBookingRowById(input.bookingId);
  if (!row) throw new NotFoundError("Réservation introuvable");
  if (row.practitionerId !== input.practitionerId) {
    throw new ForbiddenError("Cette réservation ne vous appartient pas");
  }
  return cancelBooking(ports, {
    token: row.cancelToken,
    by: "practitioner",
    reason: input.reason,
  });
}

export interface ApiBookingItem {
  id: string;
  sessionName: string;
  sessionTypeId: string | null;
  sessionVariantId: string | null;
  durationMin: number;
  startAt: string;
  endAt: string;
  status: string;
  paymentStatus: string;
  validationRequired: boolean;
  origin: string;
  roomId: string;
  patient: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
  };
  notes: string | null;
  createdAt: string;
}

export interface ApiListFilter {
  start: Date;
  end: Date;
  status?: string;
}

/**
 * Planning du praticien pour une intégration : données patients incluses
 * (la clé appartient au praticien lui-même, pas de masquage).
 */
export async function listApiBookings(
  practitionerId: string,
  filter: ApiListFilter,
): Promise<ApiBookingItem[]> {
  await requireActivePractitioner(practitionerId);
  const rows = await bookingsDal.listBookingsForPractitioner(
    practitionerId,
    filter.start,
    filter.end,
  );
  const filtered = filter.status
    ? rows.filter((row) => row.status === filter.status)
    : rows;
  return filtered.map((row) => ({
    id: row.id,
    sessionName: row.sessionNameSnapshot,
    sessionTypeId: row.sessionTypeId,
    sessionVariantId: row.sessionVariantId,
    durationMin: row.durationMinSnapshot,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    status: row.status,
    paymentStatus: row.paymentStatus,
    validationRequired: row.validationRequired,
    origin: row.origin,
    roomId: row.roomId,
    patient: {
      firstName: row.patientFirstName,
      lastName: row.patientLastName,
      email: row.patientEmail,
      phone: row.patientPhone,
    },
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  }));
}

export interface ApiCatalogRoom {
  id: string;
  name: string;
}

export interface ApiCatalogSessionType {
  id: string;
  name: string;
  description: string | null;
  variants: {
    id: string;
    durationMin: number;
    bufferAfterMin: number;
    priceDisplay: string;
  }[];
  compatibleRoomIds: string[];
}

export interface ApiCatalog {
  practitioner: { id: string; displayName: string; slug: string };
  sessionTypes: ApiCatalogSessionType[];
  rooms: ApiCatalogRoom[];
}

/** Catalogue utile à une intégration : séances actives + salles attribuables. */
export async function getApiCatalog(practitionerId: string): Promise<ApiCatalog> {
  const practitioner = await requireActivePractitioner(practitionerId);
  const [sessionTypes, roomsWithMembers] = await Promise.all([
    sessionTypesDal.listSessionTypes(practitioner.id),
    roomsDal.listRoomsWithMembers(practitioner.officeId),
  ]);
  const activeTypes = sessionTypes.filter((entry) => entry.active);
  const catalogTypes: ApiCatalogSessionType[] = [];
  for (const sessionType of activeTypes) {
    const [variants, compatibleRoomIds] = await Promise.all([
      sessionTypesDal.listVariants(sessionType.id),
      sessionTypesDal.listCompatibleRoomIds(sessionType.id),
    ]);
    catalogTypes.push({
      id: sessionType.id,
      name: sessionType.name,
      description: sessionType.description,
      variants: variants.map((variant) => ({
        id: variant.id,
        durationMin: variant.durationMin,
        bufferAfterMin: variant.bufferAfterMin,
        priceDisplay: variant.priceDisplay,
      })),
      compatibleRoomIds,
    });
  }
  const roomById = new Map(roomsWithMembers.map((entry) => [entry.room.id, entry.room]));
  const rooms: ApiCatalogRoom[] = [];
  for (const roomId of allowedRoomIdsFor(practitioner.id, roomsWithMembers)) {
    const room = roomById.get(roomId);
    if (room) rooms.push({ id: room.id, name: room.name });
  }
  return {
    practitioner: {
      id: practitioner.id,
      displayName: practitioner.displayName,
      slug: practitioner.slug,
    },
    sessionTypes: catalogTypes,
    rooms,
  };
}
