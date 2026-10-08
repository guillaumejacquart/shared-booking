import * as bookingsDal from "@/dal/bookings";
import * as membersDal from "@/dal/members";
import * as practitionersDal from "@/dal/practitioners";
import * as roomsDal from "@/dal/rooms";
import type { Booking } from "@/dal/types";
import { practitionerColor } from "@/lib/calendar-colors";
import { ForbiddenError, NotFoundError } from "./errors";

/**
 * Service de lecture des calendriers (vues FullCalendar).
 * Routes fines : l'accès (praticien connecté, membre du cabinet) est vérifié
 * ici, les routes ne font que valider la fenêtre temporelle et sérialiser.
 */

export interface SharedCalendarInput {
  userId: string;
  start: Date;
  end: Date;
}

/**
 * Données sensibles d'un événement partagé : masquées sauf pour le
 * praticien concerné (`mine`) ou le owner (`visible`), qui voient aussi
 * le lien de gestion quand le RDV est confirmé.
 */
function patientProps(
  booking: Booking,
  visible: boolean,
  mine: boolean,
): {
  patientName: string | null;
  patientEmail: string | null;
  patientPhone: string | null;
  notes: string | null;
  paymentStatus: string | null;
  cancelToken: string | null;
} {
  return {
    patientName: visible ? `${booking.patientFirstName} ${booking.patientLastName}` : null,
    patientEmail: visible ? booking.patientEmail : null,
    patientPhone: visible ? (booking.patientPhone ?? null) : null,
    notes: visible ? (booking.notes ?? null) : null,
    paymentStatus: visible ? booking.paymentStatus : null,
    cancelToken: mine && booking.status === "confirmed" ? booking.cancelToken : null,
  };
}

/** Couleurs FullCalendar selon le statut (fond doux / texte soutenu). */
function statusColors(status: string): {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
} {
  if (status === "confirmed")
    return {
      backgroundColor: "var(--brand-soft)",
      borderColor: "var(--brand-soft)",
      textColor: "var(--brand-deep)",
    };
  if (status === "pending")
    return {
      backgroundColor: "var(--warn-bg)",
      borderColor: "var(--warn-bg)",
      textColor: "var(--warn)",
    };
  if (status === "cancelled")
    return {
      backgroundColor: "var(--wash)",
      borderColor: "var(--wash)",
      textColor: "var(--faint)",
    };
  return { backgroundColor: "var(--wash)", borderColor: "var(--wash)", textColor: "var(--mist)" };
}

/**
 * Calendrier du cabinet (vue unifiée : filtre Moi / Tout le cabinet côté
 * client). Données patients masquées sauf pour soi et le owner (SPEC.md
 * §F10). Couleur des événements = statut du RDV.
 */
export async function getSharedCalendar(input: SharedCalendarInput) {
  const prac = await practitionersDal.getPractitionerByUserId(input.userId);
  if (!prac || !prac.active) throw new NotFoundError("Praticien introuvable");
  const membership = await membersDal.getMembership(prac.officeId, input.userId);
  if (!membership || !membership.active) throw new ForbiddenError("Action non autorisée");
  const isOwner = membership.role === "owner";

  const [pracs, rooms, bookings] = await Promise.all([
    practitionersDal.listPractitionersByOffice(prac.officeId),
    roomsDal.listRooms(prac.officeId),
    bookingsDal.listOfficeBookings(prac.officeId, input.start, input.end),
  ]);
  const pracById = new Map(pracs.map((prac) => [prac.id, prac]));
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const sortedIds = [...pracs].map((prac) => prac.id).sort();
  const colorOf = (practitionerId: string) => practitionerColor(sortedIds, practitionerId);

  return {
    rooms: rooms.map((room) => ({ id: room.id, name: room.name, color: room.color })),
    practitioners: pracs.map((prac) => ({
      id: prac.id,
      displayName: prac.displayName,
      color: colorOf(prac.id),
    })),
    events: bookings.map((booking) => {
      const bookingPrac = pracById.get(booking.practitionerId);
      const room = roomById.get(booking.roomId);
      const mine = booking.practitionerId === prac.id;
      const visible = mine || isOwner;
      return {
        id: booking.id,
        // Le praticien est identifié par ses initiales (rendu
        // personnalisé) ; le titre reste court.
        title: visible
          ? `${booking.sessionNameSnapshot} — ${booking.patientFirstName} ${booking.patientLastName}`
          : "Réservé",
        start: booking.startAt.toISOString(),
        end: booking.endAt.toISOString(),
        // Couleur = statut (tokens résolus côté client par FullCalendar).
        ...statusColors(booking.status),
        extendedProps: {
          status: booking.status,
          validationRequired: booking.validationRequired,
          practitionerName: bookingPrac?.displayName ?? "",
          practitionerColor: colorOf(booking.practitionerId),
          roomName: room?.name ?? "",
          roomColor: room?.color ?? null,
          sessionName: booking.sessionNameSnapshot,
          mine,
          ...patientProps(booking, visible, mine),
        },
      };
    }),
  };
}

export interface ReservationsInput {
  userId: string;
  now: Date;
}

/** Élément sérialisable de la vue « Mes réservations » (page dashboard). */
export interface ReservationItem {
  id: string;
  sessionName: string;
  startAt: string;
  endAt: string;
  patientName: string;
  patientEmail: string;
  patientPhone: string | null;
  notes: string | null;
  roomName: string;
  paymentStatus: string;
  cancelToken: string;
}

function toReservationItem(
  row: Booking,
  roomName: string,
): ReservationItem {
  return {
    id: row.id,
    sessionName: row.sessionNameSnapshot,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    patientName: `${row.patientFirstName} ${row.patientLastName}`,
    patientEmail: row.patientEmail,
    patientPhone: row.patientPhone,
    notes: row.notes,
    roomName,
    paymentStatus: row.paymentStatus,
    cancelToken: row.cancelToken,
  };
}

/**
 * Vue centralisée des réservations du praticien connecté : demandes en
 * attente de validation + confirmées à venir (triées par horaire).
 * Passé et annulés restent sur l'agenda (historique).
 */
export async function getReservations(input: ReservationsInput): Promise<{
  pending: ReservationItem[];
  upcoming: ReservationItem[];
}> {
  const prac = await practitionersDal.getPractitionerByUserId(input.userId);
  if (!prac || !prac.active) throw new NotFoundError("Praticien introuvable");
  const [pending, upcoming, rooms] = await Promise.all([
    bookingsDal.listPendingValidationForPractitioner(prac.id),
    bookingsDal.listUpcomingConfirmedForPractitioner(prac.id, input.now),
    roomsDal.listRooms(prac.officeId),
  ]);
  const roomById = new Map(rooms.map((room) => [room.id, room.name]));
  const roomNameOf = (roomId: string): string => roomById.get(roomId) ?? "";
  return {
    pending: pending.map((row) => toReservationItem(row, roomNameOf(row.roomId))),
    upcoming: upcoming.map((row) => toReservationItem(row, roomNameOf(row.roomId))),
  };
}

/** Surface du service calendrier (utilisée par les routes via le container). */
export interface CalendarService {
  shared: typeof getSharedCalendar;
  reservations: typeof getReservations;
}

export function createCalendarService(): CalendarService {
  return { shared: getSharedCalendar, reservations: getReservations };
}
