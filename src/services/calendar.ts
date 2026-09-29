import * as bookingsDal from "@/dal/bookings";
import * as membersDal from "@/dal/members";
import * as practitionersDal from "@/dal/practitioners";
import * as roomsDal from "@/dal/rooms";
import type { Booking } from "@/dal/types";
import { practitionerColor } from "@/lib/calendar-colors";
import { sortRooms } from "@/services/room-order";
import { ForbiddenError, NotFoundError } from "./errors";

/**
 * Service de lecture des calendriers (vues FullCalendar).
 * Routes fines : l'accès (praticien connecté, membre du cabinet) est vérifié
 * ici, les routes ne font que valider la fenêtre temporelle et sérialiser.
 */

export interface AgendaInput {
  userId: string;
  start: Date;
  end: Date;
}

/** Événements de l'agenda du praticien connecté (tous statuts). */
export async function getAgendaEvents(input: AgendaInput) {
  const prac = await practitionersDal.getPractitionerByUserId(input.userId);
  if (!prac || !prac.active) throw new NotFoundError("Praticien introuvable");
  const [bookings, roomsWithMembers] = await Promise.all([
    bookingsDal.listBookingsForPractitioner(prac.id, input.start, input.end),
    roomsDal.listRoomsWithMembers(prac.officeId),
  ]);
  // Résolution sur toutes les salles (une réservation peut précéder un
  // changement d'allowlist) ; la légende n'expose que les salles utilisables.
  const roomById = new Map(roomsWithMembers.map((entry) => [entry.room.id, entry.room]));
  return {
    rooms: sortRooms(
      roomsWithMembers.filter(
        (entry) => entry.practitionerIds.length === 0 || entry.practitionerIds.includes(prac.id),
      ),
    ).map((entry) => ({ id: entry.room.id, name: entry.room.name, color: entry.room.color })),
    events: bookings.map((booking) => {
      const room = roomById.get(booking.roomId);
      return {
        id: booking.id,
        title: `${booking.sessionNameSnapshot} — ${booking.patientFirstName} ${booking.patientLastName}`,
        start: booking.startAt.toISOString(),
        end: booking.endAt.toISOString(),
        // Paires fond doux / texte soutenu : lisibles en clair comme en
        // sombre (tokens résolus côté client par FullCalendar).
        backgroundColor:
          booking.status === "confirmed"
            ? "var(--brand-soft)"
            : booking.status === "pending"
              ? "var(--warn-bg)"
              : "var(--wash)",
        borderColor:
          booking.status === "confirmed"
            ? "var(--brand-soft)"
            : booking.status === "pending"
              ? "var(--warn-bg)"
              : "var(--wash)",
        textColor:
          booking.status === "confirmed"
            ? "var(--brand-deep)"
            : booking.status === "pending"
              ? "var(--warn)"
              : booking.status === "cancelled"
                ? "var(--faint)"
                : "var(--mist)",
        extendedProps: {
          status: booking.status,
          paymentStatus: booking.paymentStatus,
          validationRequired: booking.validationRequired,
          sessionName: booking.sessionNameSnapshot,
          roomName: room?.name ?? "",
          roomColor: room?.color ?? null,
          patientName: `${booking.patientFirstName} ${booking.patientLastName}`,
          patientEmail: booking.patientEmail,
          patientPhone: booking.patientPhone,
          notes: booking.notes,
          cancelToken: booking.cancelToken,
        },
      };
    }),
  };
}

export interface SharedCalendarInput {
  userId: string;
  start: Date;
  end: Date;
}

/**
 * Données patient d'un événement partagé : masquées sauf pour le praticien
 * concerné (`mine`) ou le owner (`visible`), qui voient aussi le lien de
 * gestion quand le RDV est confirmé.
 */
function patientProps(
  booking: Booking,
  visible: boolean,
  mine: boolean,
): {
  patientName: string | null;
  patientEmail: string | null;
  patientPhone: string | null;
  cancelToken: string | null;
} {
  return {
    patientName: visible ? `${booking.patientFirstName} ${booking.patientLastName}` : null,
    patientEmail: visible ? booking.patientEmail : null,
    patientPhone: visible ? (booking.patientPhone ?? null) : null,
    cancelToken: mine && booking.status === "confirmed" ? booking.cancelToken : null,
  };
}

/**
 * Calendrier partagé du cabinet. Noms des patients masqués sauf pour soi
 * et le owner (SPEC.md §F10). Couleur = praticien.
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
      const color = colorOf(booking.practitionerId);
      return {
        id: booking.id,
        // Le praticien est identifié par sa couleur + ses initiales
        // (rendu personnalisé) ; le titre reste court.
        title: visible
          ? `${booking.sessionNameSnapshot} — ${booking.patientFirstName} ${booking.patientLastName}`
          : "Réservé",
        start: booking.startAt.toISOString(),
        end: booking.endAt.toISOString(),
        backgroundColor: color,
        borderColor: color,
        textColor: "#fafafa",
        extendedProps: {
          status: booking.status,
          validationRequired: booking.validationRequired,
          practitionerName: bookingPrac?.displayName ?? "",
          practitionerColor: color,
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

/** Surface du service calendrier (utilisée par les routes via le container). */
export interface CalendarService {
  agenda: typeof getAgendaEvents;
  shared: typeof getSharedCalendar;
}

export function createCalendarService(): CalendarService {
  return { agenda: getAgendaEvents, shared: getSharedCalendar };
}
