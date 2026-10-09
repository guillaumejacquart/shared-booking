import * as availabilityDal from "@/dal/availability";
import * as bookingsDal from "@/dal/bookings";
import * as officesDal from "@/dal/offices";
import * as practitionersDal from "@/dal/practitioners";
import * as roomsDal from "@/dal/rooms";
import * as sessionTypesDal from "@/dal/session-types";
import type { Office, Practitioner, SessionTypeVariant } from "@/dal/types";
import { ANALYTICS_EVENTS } from "@/lib/analytics";
import { confirmationEmail } from "@/lib/email";
import type { Ports } from "@/lib/ports";
import type {
  BookingResult,
  ManualBookingInput,
  RoomAvailabilityInput,
} from "@/lib/schemas/bookings";
import { dateStrInTz, zonedTimeToUtc } from "@/lib/timezone";
import { bookingMutex } from "@/lib/mutex";
import { allowedRoomIdsFor, sortRooms } from "@/services/room-order";
import { syncBookingToGoogle } from "@/services/google-sync";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import {
  bookingEventData,
  mailModel,
  MAX_BUFFER_MIN,
  safeSend,
  tariffSnapshot,
  tokens,
} from "./shared";
import { resolveVariant } from "./slots";

/**
 * Réservation manuelle (saisie praticien, § discussion « créneau à la main »).
 * Même garde anti double-réservation que le parcours public
 * (`tryInsertBooking` sous mutex), mais horaire libre (hors grille),
 * `confirmed` direct et sans consentement/lead time/quota.
 */

interface ManualPlan {
  prac: Practitioner;
  office: Office;
  timezone: string;
  sessionName: string;
  currency: string;
  variant: SessionTypeVariant;
  sessionTypeId: string;
  start: Date;
  end: Date;
  compatibleRoomIds: string[];
}

/** Chevauchement strict (buffers inclus côté existant) : fin == début OK. */
function collidesWith(
  startMs: number,
  endMsBuffered: number,
  existing: { startAt: Date; endAt: Date; bufferAfterMinSnapshot: number },
): boolean {
  return (
    startMs < existing.endAt.getTime() + existing.bufferAfterMinSnapshot * 60_000 &&
    existing.startAt.getTime() < endMsBuffered
  );
}

/** Congé (`off`) chevauchant [start, end), jour entier ou partiel. */
async function findOverlappingOff(
  practitionerId: string,
  timezone: string,
  start: Date,
  end: Date,
): Promise<{ reason: string | null } | null> {
  const rows = await availabilityDal.listExceptions(
    practitionerId,
    dateStrInTz(start, timezone),
    dateStrInTz(end, timezone),
  );
  const match = rows
    .filter((row) => row.kind === "off")
    .find((row) => {
      if (row.fullDay || !row.startTime || !row.endTime) return true;
      const offStart = zonedTimeToUtc(row.date, row.startTime, timezone);
      const offEnd = zonedTimeToUtc(row.date, row.endTime, timezone);
      return start.getTime() < offEnd.getTime() && offStart.getTime() < end.getTime();
    });
  if (!match) return null;
  return { reason: match.reason };
}

function assertFutureStart(start: Date, now: Date): void {
  if (Number.isNaN(start.getTime())) throw new ValidationError("Horaire invalide");
  if (start.getTime() < now.getTime()) {
    throw new ValidationError("Impossible de réserver dans le passé");
  }
}

/**
 * Résout et valide la demande hors salle : praticien (soi), séance,
 * déclinaison, horaire. La salle est validée séparément (choix explicite).
 */
async function resolveManualPlan(
  ports: Ports,
  input: Pick<ManualBookingInput, "requesterUserId" | "sessionTypeId" | "sessionVariantId" | "startAt">,
): Promise<ManualPlan> {
  const now = ports.clock.now();
  const prac = await practitionersDal.getPractitionerByUserId(input.requesterUserId);
  if (!prac || !prac.active) throw new NotFoundError("Praticien introuvable");
  const office = await officesDal.getOfficeById(prac.officeId);
  if (!office) throw new NotFoundError("Cabinet introuvable");
  const timezone = office.timezone;

  const types = await sessionTypesDal.listSessionTypes(prac.id);
  const sessionType = types.find((entry) => entry.id === input.sessionTypeId && entry.active);
  if (!sessionType) throw new NotFoundError("Type de séance introuvable");
  const variants = await sessionTypesDal.listVariants(sessionType.id);
  const variant = resolveVariant({ ...sessionType, variants }, input.sessionVariantId);
  if (variant.bufferAfterMin > MAX_BUFFER_MIN) {
    throw new ValidationError("Configuration de séance invalide");
  }
  const start = new Date(input.startAt);
  assertFutureStart(start, now);
  const end = new Date(start.getTime() + variant.durationMin * 60_000);
  const compatibleRoomIds = await sessionTypesDal.listCompatibleRoomIds(sessionType.id);
  return {
    prac,
    office,
    timezone,
    sessionName:
      variants.length > 1 ? `${sessionType.name} (${variant.durationMin} min)` : sessionType.name,
    currency: sessionType.currency ?? "eur",
    variant,
    sessionTypeId: sessionType.id,
    start,
    end,
    compatibleRoomIds,
  };
}

/** Salle connue du cabinet, autorisée au praticien et compatible avec la séance. */
async function resolveManualRoom(plan: ManualPlan, roomId: string): Promise<void> {
  const roomsWithMembers = await roomsDal.listRoomsWithMembers(plan.office.id);
  const known = roomsWithMembers.some((entry) => entry.room.id === roomId);
  if (!known) throw new NotFoundError("Salle introuvable");
  const allowed = allowedRoomIdsFor(plan.prac.id, roomsWithMembers);
  if (!allowed.includes(roomId)) {
    throw new ForbiddenError("Salle non autorisée pour ce praticien");
  }
  if (plan.compatibleRoomIds.length > 0 && !plan.compatibleRoomIds.includes(roomId)) {
    throw new ValidationError("Salle incompatible avec ce type de séance");
  }
}

/**
 * Première salle libre sur [start, end) : même règle d'attribution que le
 * parcours public (salles autorisées au praticien ∩ compatibles avec la
 * séance, ordre déterministe), sans la contrainte de grille. Sert à
 * l'API v1 quand l'appelant ne choisit pas de salle explicite.
 */
export async function findFirstFreeRoom(input: {
  practitionerId: string;
  officeId: string;
  compatibleRoomIds: string[];
  start: Date;
  end: Date;
  bufferAfterMin: number;
}): Promise<string | null> {
  const roomsWithMembers = await roomsDal.listRoomsWithMembers(input.officeId);
  const candidates = allowedRoomIdsFor(input.practitionerId, roomsWithMembers).filter(
    (roomId) =>
      input.compatibleRoomIds.length === 0 || input.compatibleRoomIds.includes(roomId),
  );
  const endBuffered = input.end.getTime() + input.bufferAfterMin * 60_000;
  for (const roomId of candidates) {
    const busy = await bookingsDal.listActiveBookings({
      roomIds: [roomId],
      from: input.start,
      to: input.end,
    });
    const occupied = busy.some((booking) =>
      collidesWith(input.start.getTime(), endBuffered, booking),
    );
    if (!occupied) return roomId;
  }
  return null;
}

/** Insertion protégée : la garde DAL tranche les courses (mutex mono-processus). */
async function insertManualBookingGuarded(
  plan: ManualPlan,
  input: ManualBookingInput,
  email: string,
): Promise<{ id: string; cancelToken: string; rescheduleToken: string }> {
  const generated = tokens();
  const bookingId = crypto.randomUUID();
  const endBuffered = plan.end.getTime() + plan.variant.bufferAfterMin * 60_000;
  const insertedId = await bookingMutex.run(async () => {
    const pracBusy = await bookingsDal.listActiveBookings({
      practitionerId: plan.prac.id,
      from: plan.start,
      to: plan.end,
    });
    if (pracBusy.some((booking) => collidesWith(plan.start.getTime(), endBuffered, booking))) {
      throw new ConflictError("Le praticien est déjà occupé à cet horaire");
    }
    const roomBusy = await bookingsDal.listActiveBookings({
      roomIds: [input.roomId],
      from: plan.start,
      to: plan.end,
    });
    if (roomBusy.some((booking) => collidesWith(plan.start.getTime(), endBuffered, booking))) {
      throw new ConflictError("La salle est déjà occupée à cet horaire");
    }
    const inserted = await bookingsDal.tryInsertBooking({
      id: bookingId,
      officeId: plan.office.id,
      practitionerId: plan.prac.id,
      roomId: input.roomId,
      sessionTypeId: plan.sessionTypeId,
      sessionVariantId: plan.variant.id,
      sessionNameSnapshot: plan.sessionName,
      durationMinSnapshot: plan.variant.durationMin,
      bufferAfterMinSnapshot: plan.variant.bufferAfterMin,
      ...tariffSnapshot(plan.currency, plan.variant),
      startAt: plan.start,
      endAt: plan.end,
      patientFirstName: input.patientFirstName,
      patientLastName: input.patientLastName,
      patientEmail: email,
      patientPhone: input.patientPhone,
      notes: input.notes,
      cancelToken: generated.cancelToken,
      rescheduleToken: generated.rescheduleToken,
      status: "confirmed",
      paymentStatus: "none",
      validationRequired: false,
      origin: input.origin,
    });
    if (inserted.conflict) throw new ConflictError("Créneau déjà réservé");
    return inserted.id;
  });
  return { id: insertedId, ...generated };
}

export async function createManualBooking(
  ports: Ports,
  input: ManualBookingInput,
): Promise<BookingResult> {
  const plan = await resolveManualPlan(ports, input);
  await resolveManualRoom(plan, input.roomId);
  if (!input.overrideOff) {
    const off = await findOverlappingOff(plan.prac.id, plan.timezone, plan.start, plan.end);
    if (off) {
      throw new ConflictError(
        "Ce créneau chevauche un congé. Cochez « forcer malgré le congé » pour passer outre.",
      );
    }
  }
  const email = input.patientEmail.toLowerCase();
  const created = await insertManualBookingGuarded(plan, input, email);

  const detail = { practitioner: plan.prac, office: plan.office };
  const model = mailModel(
    {
      id: created.id,
      sessionNameSnapshot: plan.sessionName,
      startAt: plan.start,
      endAt: plan.end,
      patientEmail: email,
      cancelToken: created.cancelToken,
      paymentStatus: "none",
      priceDisplaySnapshot: plan.variant.priceDisplay ?? null,
      currencySnapshot: plan.currency,
    },
    detail,
    { now: ports.clock.now() },
  );
  await safeSend(ports.sendEmail, confirmationEmail(email, model));
  await syncBookingToGoogle(ports, created.id);
  await ports.analytics.track(
    ANALYTICS_EVENTS.BOOKING_CONFIRMED,
    bookingEventData({
      practitionerSlug: plan.prac.slug,
      durationMin: plan.variant.durationMin,
      requiresValidation: false,
    }),
  );
  return {
    id: created.id,
    status: "confirmed",
    startAt: plan.start.toISOString(),
    endAt: plan.end.toISOString(),
    cancelToken: created.cancelToken,
    rescheduleToken: created.rescheduleToken,
    requiresPayment: false,
  };
}

// --- Contrôle live des salles (formulaire) -----------------------------------

export interface RoomAvailability {
  startAt: string;
  endAt: string;
  practitioner: { status: "free" | "busy" | "off"; reason: string | null };
  rooms: { id: string; name: string; color: string | null; free: boolean }[];
}

/** État des salles à un horaire donné (aide visuelle, la garde tranche au submit). */
export async function getRoomAvailability(
  ports: Ports,
  input: RoomAvailabilityInput,
): Promise<RoomAvailability> {
  const plan = await resolveManualPlan(ports, input);
  const endBuffered = plan.end.getTime() + plan.variant.bufferAfterMin * 60_000;
  const roomsWithMembers = await roomsDal.listRoomsWithMembers(plan.office.id);
  const allowed = new Set(allowedRoomIdsFor(plan.prac.id, roomsWithMembers));
  const candidates = sortRooms(
    roomsWithMembers.filter(
      (entry) =>
        allowed.has(entry.room.id) &&
        (plan.compatibleRoomIds.length === 0 || plan.compatibleRoomIds.includes(entry.room.id)),
    ),
  );
  const [pracBusy, roomBusy, off] = await Promise.all([
    bookingsDal.listActiveBookings({
      practitionerId: plan.prac.id,
      from: plan.start,
      to: plan.end,
    }),
    candidates.length > 0
      ? bookingsDal.listActiveBookings({
          roomIds: candidates.map((entry) => entry.room.id),
          from: plan.start,
          to: plan.end,
        })
      : Promise.resolve([]),
    findOverlappingOff(plan.prac.id, plan.timezone, plan.start, plan.end),
  ]);
  const busyByRoom = new Map<string, typeof roomBusy>();
  for (const booking of roomBusy) {
    const list = busyByRoom.get(booking.roomId) ?? [];
    list.push(booking);
    busyByRoom.set(booking.roomId, list);
  }
  const practitionerBusy = pracBusy.some((booking) =>
    collidesWith(plan.start.getTime(), endBuffered, booking),
  );
  return {
    startAt: plan.start.toISOString(),
    endAt: plan.end.toISOString(),
    practitioner: {
      status: practitionerBusy ? "busy" : off ? "off" : "free",
      reason: practitionerBusy ? null : (off?.reason ?? null),
    },
    rooms: candidates.map((entry) => ({
      id: entry.room.id,
      name: entry.room.name,
      color: entry.room.color,
      free: !(busyByRoom.get(entry.room.id) ?? []).some((booking) =>
        collidesWith(plan.start.getTime(), endBuffered, booking),
      ),
    })),
  };
}

// --- Données du formulaire (séances + salles du praticien) --------------------

export interface ManualFormData {
  timezone: string;
  sessionTypes: {
    id: string;
    name: string;
    variants: { id: string; durationMin: number; bufferAfterMin: number }[];
  }[];
  rooms: { id: string; name: string; color: string | null }[];
}

/** Séances actives (avec variantes) et salles autorisées, pour le formulaire. */
export async function getManualFormData(requesterUserId: string): Promise<ManualFormData> {
  const prac = await practitionersDal.getPractitionerByUserId(requesterUserId);
  if (!prac || !prac.active) throw new NotFoundError("Praticien introuvable");
  const office = await officesDal.getOfficeById(prac.officeId);
  if (!office) throw new NotFoundError("Cabinet introuvable");
  const [types, variants, roomsWithMembers] = await Promise.all([
    sessionTypesDal.listSessionTypes(prac.id),
    sessionTypesDal.listVariantsByPractitioner(prac.id),
    roomsDal.listRoomsWithMembers(prac.officeId),
  ]);
  const variantsByType = new Map<string, { id: string; durationMin: number; bufferAfterMin: number }[]>();
  for (const entry of variants) {
    const list = variantsByType.get(entry.sessionTypeId) ?? [];
    list.push({
      id: entry.variant.id,
      durationMin: entry.variant.durationMin,
      bufferAfterMin: entry.variant.bufferAfterMin,
    });
    variantsByType.set(entry.sessionTypeId, list);
  }
  const allowed = new Set(allowedRoomIdsFor(prac.id, roomsWithMembers));
  return {
    timezone: office.timezone,
    sessionTypes: types
      .filter((entry) => entry.active && (variantsByType.get(entry.id) ?? []).length > 0)
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        variants: variantsByType.get(entry.id) ?? [],
      })),
    rooms: sortRooms(roomsWithMembers.filter((entry) => allowed.has(entry.room.id))).map((entry) => ({
      id: entry.room.id,
      name: entry.room.name,
      color: entry.room.color,
    })),
  };
}
