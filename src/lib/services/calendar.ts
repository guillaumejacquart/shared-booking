import * as bookingsDal from "@/dal/bookings";
import * as membersDal from "@/dal/members";
import * as practitionersDal from "@/dal/practitioners";
import * as roomsDal from "@/dal/rooms";
import { practitionerColor } from "@/lib/calendar-colors";
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
  const roomById = new Map(roomsWithMembers.map((r) => [r.room.id, r.room]));
  return {
    rooms: roomsWithMembers
      .filter((r) => r.practitionerIds.length === 0 || r.practitionerIds.includes(prac.id))
      .sort((a, b) =>
        a.room.sortOrder - b.room.sortOrder ||
        a.room.name.localeCompare(b.room.name) ||
        (a.room.id < b.room.id ? -1 : a.room.id > b.room.id ? 1 : 0))
      .map((r) => ({ id: r.room.id, name: r.room.name, color: r.room.color })),
    events: bookings.map((b) => {
      const room = roomById.get(b.roomId);
      return {
        id: b.id,
        title: `${b.sessionNameSnapshot} — ${b.patientFirstName} ${b.patientLastName}`,
        start: b.startAt.toISOString(),
        end: b.endAt.toISOString(),
        // Paires fond doux / texte soutenu : lisibles en clair comme en
        // sombre (tokens résolus côté client par FullCalendar).
        backgroundColor:
          b.status === "confirmed"
            ? "var(--brand-soft)"
            : b.status === "pending"
              ? "var(--warn-bg)"
              : "var(--wash)",
        borderColor:
          b.status === "confirmed"
            ? "var(--brand-soft)"
            : b.status === "pending"
              ? "var(--warn-bg)"
              : "var(--wash)",
        textColor:
          b.status === "confirmed"
            ? "var(--brand-deep)"
            : b.status === "pending"
              ? "var(--warn)"
              : b.status === "cancelled"
                ? "var(--faint)"
                : "var(--mist)",
        extendedProps: {
          status: b.status,
          paymentStatus: b.paymentStatus,
          validationRequired: b.validationRequired,
          sessionName: b.sessionNameSnapshot,
          roomName: room?.name ?? "",
          roomColor: room?.color ?? null,
          patientName: `${b.patientFirstName} ${b.patientLastName}`,
          patientEmail: b.patientEmail,
          patientPhone: b.patientPhone,
          notes: b.notes,
          cancelToken: b.cancelToken,
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
  const pracById = new Map(pracs.map((p) => [p.id, p]));
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const sortedIds = [...pracs].map((p) => p.id).sort();
  const colorOf = (practitionerId: string) => practitionerColor(sortedIds, practitionerId);

  return {
    rooms: rooms.map((r) => ({ id: r.id, name: r.name, color: r.color })),
    practitioners: pracs.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      color: colorOf(p.id),
    })),
    events: bookings.map((b) => {
      const p = pracById.get(b.practitionerId);
      const room = roomById.get(b.roomId);
      const mine = b.practitionerId === prac.id;
      const visible = mine || isOwner;
      const color = colorOf(b.practitionerId);
      return {
        id: b.id,
        // Le praticien est identifié par sa couleur + ses initiales
        // (rendu personnalisé) ; le titre reste court.
        title: visible
          ? `${b.sessionNameSnapshot} — ${b.patientFirstName} ${b.patientLastName}`
          : "Réservé",
        start: b.startAt.toISOString(),
        end: b.endAt.toISOString(),
        backgroundColor: color,
        borderColor: color,
        textColor: "#fafafa",
        extendedProps: {
          status: b.status,
          validationRequired: b.validationRequired,
          practitionerName: p?.displayName ?? "",
          practitionerColor: color,
          roomName: room?.name ?? "",
          roomColor: room?.color ?? null,
          sessionName: b.sessionNameSnapshot,
          mine,
          patientName: visible ? `${b.patientFirstName} ${b.patientLastName}` : null,
          patientEmail: visible ? b.patientEmail : null,
          patientPhone: visible ? (b.patientPhone ?? null) : null,
          cancelToken: mine && b.status === "confirmed" ? b.cancelToken : null,
        },
      };
    }),
  };
}
