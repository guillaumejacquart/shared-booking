import * as availabilityDal from "@/dal/availability";
import * as bookingsDal from "@/dal/bookings";
import * as practitionersDal from "@/dal/practitioners";
import * as roomsDal from "@/dal/rooms";
import * as sessionTypesDal from "@/dal/session-types";
import { allowedRoomIdsFor } from "@/lib/rooms";
import type { SlotsInput } from "@/lib/schemas/bookings";
import { dateStrInTz, zonedTimeToUtc } from "@/lib/timezone";
import { generateSlots, type Occupancy, type Slot, type SlotRequest } from "@/lib/slots";
import { NotFoundError } from "../errors";
import type { Deps } from "./shared";

export { allowedRoomIdsFor };

// --- Disponibilités ---------------------------------------------------------

export interface PublicSlot {
  startAt: string; // ISO UTC
  endAt: string;
}

/** Occupation d'un RDV, buffer de fin inclus. */
export function toOccupancy(b: {
  startAt: Date;
  endAt: Date;
  bufferAfterMinSnapshot: number;
}): Occupancy {
  return {
    start: b.startAt,
    end: new Date(b.endAt.getTime() + b.bufferAfterMinSnapshot * 60_000),
  };
}

export function toWindows(
  rules: { weekday: number; startTime: string; endTime: string }[],
): SlotRequest["windows"] {
  return rules.map((r) => ({
    weekday: r.weekday,
    startTime: r.startTime,
    endTime: r.endTime,
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
  return rows.map((e) => ({
    date: e.date,
    kind: e.kind as "off" | "extra",
    startTime: e.startTime ?? undefined,
    endTime: e.endTime ?? undefined,
    fullDay: e.fullDay,
    roomId: e.roomId ?? undefined,
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
    .filter((e) => e.kind === "extra" && e.roomId)
    .map((e) => e.roomId as string);
  const watchIds = [...new Set([...allowedRoomIds, ...extraRoomIds])];
  const roomBookings =
    watchIds.length > 0
      ? await bookingsDal.listActiveBookings({ roomIds: watchIds, from, to, excludeBookingId })
      : [];
  const roomBusy: Record<string, Occupancy[]> = {};
  for (const b of roomBookings) {
    (roomBusy[b.roomId] ??= []).push(toOccupancy(b));
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

/** Grille interne : chaque créneau porte sa salle attribuée. */
export async function getSlotsWithRoom(deps: Deps, input: SlotsInput): Promise<Slot[]> {
  const now = deps.now ?? new Date();

  const page = await practitionersDal.getPractitionerPage(input.practitionerSlug);
  if (!page) throw new NotFoundError("Praticien introuvable");
  const st = page.sessionTypes.find((t) => t.id === input.sessionTypeId);
  if (!st) throw new NotFoundError("Type de séance introuvable");

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
    st.id,
  );
  return generateSlots({
    timezone: tz,
    ...context,
    sessionDurationMin: st.durationMin,
    bufferAfterMin: st.bufferAfterMin,
    leadTimeMin: page.office.bookingLeadTimeMin,
    from: engineFrom,
    days: input.days,
  });
}

export async function getAvailableSlots(deps: Deps, input: SlotsInput): Promise<PublicSlot[]> {
  const slots = await getSlotsWithRoom(deps, input);
  return slots.map((s) => ({
    startAt: s.start.toISOString(),
    endAt: s.end.toISOString(),
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
  const [rules, roomsWithMembers, sessionRoomIds] = await Promise.all([
    availabilityDal.listRules(practitionerId),
    roomsDal.listRoomsWithMembers(officeId),
    sessionTypesDal.listCompatibleRoomIds(sessionTypeId),
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
    leadTimeMin: 0,
    from: new Date(start.getTime() - 86_400_000),
    days: 3,
  });
  return slots.some((s) => s.start.getTime() === start.getTime());
}
