import * as bookingsDal from "@/dal/bookings";
import * as officesDal from "@/dal/offices";
import * as practitionersDal from "@/dal/practitioners";
import * as roomsDal from "@/dal/rooms";
import * as sessionTypesDal from "@/dal/session-types";
import type { Booking } from "@/dal/types";
import type { Ports } from "@/lib/ports";
import { dateStrInTz } from "@/lib/timezone";
import { NotFoundError, ValidationError } from "./errors";

/**
 * Statistiques du praticien connecté (données propres uniquement, pas de
 * vue owner pour l'instant). Les `pending` tiennent un créneau (paiement,
 * validation) : exclus des KPIs, listés seulement en « Tous ».
 */

export const STATS_MAX_RANGE_DAYS = 370;
export const STATS_MAX_ROWS = 2000;

export type StatsKind = "honored" | "upcoming" | "cancelled" | "pending";
export type StatsStatusFilter = "all" | "honored" | "upcoming" | "cancelled";

export interface StatsInput {
  userId: string;
  from: Date;
  to: Date;
  status?: StatsStatusFilter;
  sessionTypeId?: string;
  roomId?: string;
}

export interface StatsRow {
  id: string;
  startAt: string;
  sessionName: string;
  sessionTypeId: string | null;
  roomId: string;
  roomName: string;
  durationMin: number;
  kind: StatsKind;
  cancelledBy: string | null;
  leadDays: number | null;
  isReturning: boolean;
  priceCents: number | null;
  currency: string | null;
}

export interface StatsKpis {
  honored: number;
  upcoming: number;
  cancelled: number;
  pending: number;
  cancelRate: number | null;
  cancelledByPatient: number;
  cancelledByPractitioner: number;
  returningRate: number | null;
  medianLeadDays: number | null;
}

export interface StatsWeek {
  weekStart: string;
  honored: number;
  cancelled: number;
}

export interface StatsSession {
  name: string;
  count: number;
  honored: number;
  cancelled: number;
  minutes: number;
}

export interface StatsRevenue {
  totals: { currency: string; cents: number }[];
  unknownPriceCount: number;
}

export interface StatsResult {
  kpis: StatsKpis;
  weekly: StatsWeek[];
  bySession: StatsSession[];
  revenue: StatsRevenue;
  rows: StatsRow[];
  truncated: boolean;
  options: {
    sessions: { id: string; name: string }[];
    rooms: { id: string; name: string }[];
  };
}

/** Email normalisé (nouveau vs revenant sans exposer d'adresses). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Catégorie d'une réservation à l'instant `now` (passé confirmé = honoré). */
export function bookingKind(row: Booking, now: Date): StatsKind {
  if (row.status === "cancelled") return "cancelled";
  if (row.status === "pending") return "pending";
  return row.startAt.getTime() < now.getTime() ? "honored" : "upcoming";
}

/** Délai réservation → séance en jours (1 décimale), null si incohérent. */
export function leadDaysOf(row: Booking): number | null {
  const diffDays = (row.startAt.getTime() - row.createdAt.getTime()) / 86_400_000;
  if (!Number.isFinite(diffDays) || diffDays < 0) return null;
  return Math.round(diffDays * 10) / 10;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const picked = sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(picked * 10) / 10;
}

/** Lundi (YYYY-MM-DD mural) de la semaine contenant `dayStr`. */
export function mondayOf(dayStr: string): string {
  const [year, month, day] = dayStr.split("-").map(Number);
  const noon = Date.UTC(year, month - 1, day, 12);
  const weekday = new Date(noon).getUTCDay();
  const back = (weekday + 6) % 7;
  const monday = new Date(noon - back * 86_400_000);
  const iso = monday.toISOString();
  return iso.slice(0, 10);
}

/** Agrège les KPIs sur des lignes déjà filtrées (pending exclus du taux). */
export function computeKpis(
  rows: { kind: StatsKind; cancelledBy: string | null; leadDays: number | null; isReturning: boolean }[],
): StatsKpis {
  const honored = rows.filter((row) => row.kind === "honored").length;
  const upcoming = rows.filter((row) => row.kind === "upcoming").length;
  const cancelled = rows.filter((row) => row.kind === "cancelled").length;
  const pending = rows.filter((row) => row.kind === "pending").length;
  const denom = honored + cancelled;
  const known = rows.filter((row) => row.kind !== "pending");
  const returning = known.filter((row) => row.isReturning).length;
  const leads = rows.flatMap((row) => (row.leadDays === null ? [] : [row.leadDays]));
  return {
    honored,
    upcoming,
    cancelled,
    pending,
    cancelRate: denom === 0 ? null : Math.round((cancelled / denom) * 1000) / 10,
    cancelledByPatient: rows.filter((row) => row.kind === "cancelled" && row.cancelledBy === "patient").length,
    cancelledByPractitioner: rows.filter((row) => row.kind === "cancelled" && row.cancelledBy === "practitioner").length,
    returningRate: known.length === 0 ? null : Math.round((returning / known.length) * 1000) / 10,
    medianLeadDays: median(leads),
  };
}

/** CA honoré par devise (snapshot au booking, NULL = tarif inconnu). */
export function computeRevenue(
  rows: { kind: StatsKind; priceCents: number | null; currency: string | null }[],
): StatsRevenue {
  const honored = rows.filter((row) => row.kind === "honored");
  const priced = honored.filter((row) => row.priceCents !== null);
  const byCurrency = new Map<string, number>();
  for (const row of priced) {
    const currency = (row.currency ?? "eur").toLowerCase();
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + (row.priceCents ?? 0));
  }
  return {
    totals: [...byCurrency.entries()]
      .map(([currency, cents]) => ({ currency, cents }))
      .sort((left, right) => left.currency.localeCompare(right.currency)),
    unknownPriceCount: honored.length - priced.length,
  };
}

export interface EnrichedRow {
  row: Booking;
  kind: StatsKind;
  leadDays: number | null;
  isReturning: boolean;
}

export interface StatsService {
  getStats(input: StatsInput): Promise<StatsResult>;
}

export function createStatsService(ports: Ports): StatsService {
  return {
    getStats: (input) => getStats(ports, input),
  };
}

async function getStats(ports: Ports, input: StatsInput): Promise<StatsResult> {
  const now = ports.clock.now();
  const prac = await practitionersDal.getPractitionerByUserId(input.userId);
  if (!prac || !prac.active) throw new NotFoundError("Praticien introuvable");
  if (input.from.getTime() >= input.to.getTime()) {
    throw new ValidationError("Période invalide");
  }
  const rangeDays = (input.to.getTime() - input.from.getTime()) / 86_400_000;
  if (rangeDays > STATS_MAX_RANGE_DAYS) throw new ValidationError("Période trop longue");

  const officeId = prac.officeId;
  const [allRows, priorEmails, roomsWithMembers, sessionTypes] = await Promise.all([
    bookingsDal.listBookingsForStats(prac.id, input.from, input.to),
    bookingsDal.listPatientEmailsBefore(prac.id, input.from),
    roomsDal.listRoomsWithMembers(officeId),
    sessionTypesDal.listSessionTypes(prac.id),
  ]);
  const knownEmails = new Set(priorEmails.map(normalizeEmail));
  const roomById = new Map(roomsWithMembers.map((entry) => [entry.room.id, entry.room.name]));
  const allowedRooms = roomsWithMembers
    .filter(
      (entry) => entry.practitionerIds.length === 0 || entry.practitionerIds.includes(prac.id),
    )
    .map((entry) => entry.room);

  const timezone = (await officesDal.getOfficeById(officeId))?.timezone ?? "Europe/Paris";
  const filtered = allRows.filter(
    (row) =>
      (!input.sessionTypeId || row.sessionTypeId === input.sessionTypeId) &&
      (!input.roomId || row.roomId === input.roomId),
  );
  const statusFilter = input.status ?? "all";
  const visible = filtered.filter((row) =>
    statusFilter === "all" ? true : bookingKind(row, now) === statusFilter,
  );
  const truncated = visible.length > STATS_MAX_ROWS;
  const kept = truncated ? visible.slice(0, STATS_MAX_ROWS) : visible;

  const enriched: EnrichedRow[] = kept.map((row) => ({
    row,
    kind: bookingKind(row, now),
    leadDays: leadDaysOf(row),
    isReturning: knownEmails.has(normalizeEmail(row.patientEmail)),
  }));
  const rows = toStatsRows(enriched, roomById);

  return {
    kpis: computeKpis(enriched.map((item) => ({
      kind: item.kind,
      cancelledBy: item.row.cancelledBy,
      leadDays: item.leadDays,
      isReturning: item.isReturning,
    }))),
    weekly: buildWeekly(enriched, timezone),
    bySession: buildBySession(enriched),
    revenue: computeRevenue(enriched.map((item) => ({
      kind: item.kind,
      priceCents: item.row.priceCentsSnapshot,
      currency: item.row.currencySnapshot,
    }))),
    rows,
    truncated,
    options: {
      sessions: sessionTypes.map((sessionType) => ({ id: sessionType.id, name: sessionType.name })),
      rooms: allowedRooms.map((room) => ({ id: room.id, name: room.name })),
    },
  };
}

function toStatsRows(enriched: EnrichedRow[], roomById: Map<string, string>): StatsRow[] {
  return enriched.map((item) => ({
    id: item.row.id,
    startAt: item.row.startAt.toISOString(),
    sessionName: item.row.sessionNameSnapshot,
    sessionTypeId: item.row.sessionTypeId,
    roomId: item.row.roomId,
    roomName: roomById.get(item.row.roomId) ?? "",
    durationMin: item.row.durationMinSnapshot,
    kind: item.kind,
    cancelledBy: item.row.cancelledBy,
    leadDays: item.leadDays,
    isReturning: item.isReturning,
    priceCents: item.row.priceCentsSnapshot,
    currency: item.row.currencySnapshot,
  }));
}

function buildWeekly(
  enriched: EnrichedRow[],
  officeTz: string,
): StatsWeek[] {
  const buckets = new Map<string, StatsWeek>();
  for (const item of enriched) {
    if (item.kind === "pending" || item.kind === "upcoming") continue;
    const weekStart = mondayOf(dateStrInTz(item.row.startAt, officeTz));
    const bucket = buckets.get(weekStart) ?? { weekStart, honored: 0, cancelled: 0 };
    if (item.kind === "honored") bucket.honored += 1;
    else bucket.cancelled += 1;
    buckets.set(weekStart, bucket);
  }
  return [...buckets.values()].sort((left, right) => left.weekStart.localeCompare(right.weekStart));
}

function buildBySession(
  enriched: EnrichedRow[],
): StatsSession[] {
  const buckets = new Map<string, StatsSession>();
  for (const item of enriched) {
    if (item.kind === "pending") continue;
    const name = item.row.sessionNameSnapshot;
    const bucket = buckets.get(name) ?? { name, count: 0, honored: 0, cancelled: 0, minutes: 0 };
    bucket.count += 1;
    bucket.minutes += item.row.durationMinSnapshot;
    if (item.kind === "honored") bucket.honored += 1;
    if (item.kind === "cancelled") bucket.cancelled += 1;
    buckets.set(name, bucket);
  }
  return [...buckets.values()].sort((left, right) => right.count - left.count);
}
