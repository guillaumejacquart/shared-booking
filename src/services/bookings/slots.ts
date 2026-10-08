import * as availabilityDal from "@/dal/availability";
import * as bookingsDal from "@/dal/bookings";
import * as practitionersDal from "@/dal/practitioners";
import * as roomsDal from "@/dal/rooms";
import * as sessionTypesDal from "@/dal/session-types";
import type { Ports } from "@/lib/ports";
import { allowedRoomIdsFor } from "@/services/room-order";
import type { PageSessionType } from "@/dal/practitioners";
import type { SessionTypeVariant } from "@/dal/types";
import type { SlotsInput } from "@/lib/schemas/bookings";
import { dateStrInTz, zonedTimeToUtc } from "@/lib/timezone";
import { generateSlots, type Occupancy, type Slot, type SlotRequest } from "@/services/slot-engine";
import { NotFoundError, ValidationError } from "../errors";

export { allowedRoomIdsFor };

// --- Disponibilités ---------------------------------------------------------

export interface PublicSlot {
  startAt: string; // ISO UTC
  endAt: string;
}

/** Occupation d'un RDV, buffer de fin inclus. */
export function toOccupancy(booking: {
  startAt: Date;
  endAt: Date;
  bufferAfterMinSnapshot: number;
}): Occupancy {
  return {
    start: booking.startAt,
    end: new Date(booking.endAt.getTime() + booking.bufferAfterMinSnapshot * 60_000),
  };
}

export function toWindows(
  rules: { weekday: number; startTime: string; endTime: string }[],
): SlotRequest["windows"] {
  return rules.map((rule) => ({
    weekday: rule.weekday,
    startTime: rule.startTime,
    endTime: rule.endTime,
  }));
}

export function toExceptions(
  rows: {
    date: string;
    kind: string;
    startTime: string | null;
    endTime: string | null;
    fullDay: boolean;
    roomId: string | null;
  }[],
): SlotRequest["exceptions"] {
  return rows.map((row) => ({
    date: row.date,
    kind: row.kind as "off" | "extra",
    startTime: row.startTime ?? undefined,
    endTime: row.endTime ?? undefined,
    fullDay: row.fullDay,
    roomId: row.roomId ?? undefined,
  }));
}

/**
 * Charge tout ce qu'il faut pour générer une grille : règles (sans salle),
 * exceptions et occupation (praticien + salles autorisées). Partagé par les
 * disponibilités publiques et le report, pour éviter que les deux vues
 * divergent. Chaque créneau généré porte déjà sa salle attribuée.
 */
export async function loadSlotContext(
  practitionerId: string,
  officeId: string,
  from: Date,
  to: Date,
  timezone: string,
  excludeBookingId?: string,
  sessionTypeId?: string,
): Promise<
  Pick<SlotRequest, "windows" | "exceptions" | "practitionerBusy" | "roomBusy" | "allowedRoomIds" | "sessionRoomIds">
> {
  const [rules, exceptions, bookings, roomsWithMembers, sessionRoomIds] = await Promise.all([
    availabilityDal.listRules(practitionerId),
    availabilityDal.listExceptions(
      practitionerId,
      dateStrInTz(from, timezone),
      dateStrInTz(to, timezone),
    ),
    bookingsDal.listActiveBookings({
      practitionerId,
      from,
      to,
      excludeBookingId,
    }),
    roomsDal.listRoomsWithMembers(officeId),
    sessionTypeId ? sessionTypesDal.listCompatibleRoomIds(sessionTypeId) : Promise.resolve([] as string[]),
  ]);
  const allowedRoomIds = allowedRoomIdsFor(practitionerId, roomsWithMembers);
  // Surveiller aussi les salles épinglées par les extras (hors autorisées).
  const extraRoomIds = exceptions
    .filter((exception) => exception.kind === "extra" && exception.roomId)
    .map((exception) => exception.roomId as string);
  const watchIds = [...new Set([...allowedRoomIds, ...extraRoomIds])];
  const roomBookings =
    watchIds.length > 0
      ? await bookingsDal.listActiveBookings({ roomIds: watchIds, from, to, excludeBookingId })
      : [];
  const roomBusy: Record<string, Occupancy[]> = {};
  for (const booking of roomBookings) {
    (roomBusy[booking.roomId] ??= []).push(toOccupancy(booking));
  }
  return {
    windows: toWindows(rules),
    exceptions: toExceptions(exceptions),
    practitionerBusy: bookings.map(toOccupancy),
    roomBusy,
    allowedRoomIds,
    sessionRoomIds,
  };
}

/**
 * Déclinaison visée d'une séance : explicite si fournie (404 si inconnue),
 * sinon la première variante (ordre d'affichage). Une séance sans variante
 * est mal configurée (ne devrait pas arriver : migration + garde service).
 */
export function resolveVariant(st: PageSessionType, variantId?: string): SessionTypeVariant {
  if (st.variants.length === 0) {
    throw new ValidationError("Séance mal configurée : aucune déclinaison");
  }
  if (variantId) {
    const found = st.variants.find((variant) => variant.id === variantId);
    if (!found) throw new NotFoundError("Déclinaison introuvable");
    return found;
  }
  return st.variants[0];
}

/** Grille interne : chaque créneau porte sa salle attribuée. */
export async function getSlotsWithRoom(ports: Ports, input: SlotsInput): Promise<Slot[]> {
  const now = ports.clock.now();

  const page = await practitionersDal.getPractitionerPage(input.practitionerSlug);
  if (!page) throw new NotFoundError("Praticien introuvable");
  const sessionType = page.sessionTypes.find((st) => st.id === input.sessionTypeId);
  if (!sessionType) throw new NotFoundError("Type de séance introuvable");
  const variant = resolveVariant(sessionType, input.sessionVariantId);

  const tz = page.office.timezone;
  const dayStart = zonedTimeToUtc(input.fromDate, "00:00", tz);
  const engineFrom = now.getTime() < dayStart.getTime() ? dayStart : now;
  const horizonEnd = new Date(engineFrom.getTime() + input.days * 86_400_000);

  const context = await loadSlotContext(
    page.practitioner.id,
    page.office.id,
    engineFrom,
    horizonEnd,
    tz,
    undefined,
    sessionType.id,
  );
  return generateSlots({
    timezone: tz,
    ...context,
    sessionDurationMin: variant.durationMin,
    bufferAfterMin: variant.bufferAfterMin,
    slotStepMin: page.practitioner.slotStepMin ?? 15,
    leadTimeMin: page.office.bookingLeadTimeMin,
    from: engineFrom,
    days: input.days,
  });
}

export async function getAvailableSlots(ports: Ports, input: SlotsInput): Promise<PublicSlot[]> {
  const slots = await getSlotsWithRoom(ports, input);
  return slots.map((slot) => ({
    startAt: slot.start.toISOString(),
    endAt: slot.end.toISOString(),
  }));
}

/**
 * Le créneau existe-t-il dans la grille théorique (sans occupation) ?
 * Sert à distinguer un horaire hors-grille (400) d'un créneau pris (409).
 * La salle attribuée ici n'est qu'indicative : seule compte l'existence.
 */
export async function slotOnGrid(
  practitionerId: string,
  officeId: string,
  sessionTypeId: string,
  durationMin: number,
  bufferAfterMin: number,
  start: Date,
  timezone: string,
): Promise<boolean> {
  const [rules, roomsWithMembers, sessionRoomIds, prac] = await Promise.all([
    availabilityDal.listRules(practitionerId),
    roomsDal.listRoomsWithMembers(officeId),
    sessionTypesDal.listCompatibleRoomIds(sessionTypeId),
    practitionersDal.getPractitionerById(practitionerId),
  ]);
  const slots = generateSlots({
    timezone,
    windows: toWindows(rules),
    exceptions: [],
    practitionerBusy: [],
    roomBusy: {},
    allowedRoomIds: allowedRoomIdsFor(practitionerId, roomsWithMembers),
    sessionRoomIds,
    sessionDurationMin: durationMin,
    bufferAfterMin,
    slotStepMin: prac?.slotStepMin ?? 15,
    leadTimeMin: 0,
    from: new Date(start.getTime() - 86_400_000),
    days: 3,
  });
  return slots.some((slot) => slot.start.getTime() === start.getTime());
}
