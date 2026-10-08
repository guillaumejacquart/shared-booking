import "dotenv/config";
import { randomBytes } from "node:crypto";

import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { auth } from "@/lib/auth";
import { dateStrInTz, weekdayInTz, zonedTimeToUtc } from "@/lib/timezone";

/**
 * Cabinet démo « les Tilleuls » : vitrine complète de l'app, re-jouable.
 * Remet TOUTE la base à zéro (comptes + métier) puis recrée un jeu cohérent
 * avec des rendez-vous dans le passé (historique, stats, CA) et dans le
 * futur (agenda, validations en attente). Les dates sont relatives à
 * aujourd'hui : chaque exécution donne un agenda futur rempli.
 *
 * Ce qu'on y showcase :
 * - 4 praticiens (grilles 15/30 min, validation systématique pour Inès,
 *   règlements sur place variés) + 1 invitation en attente ;
 * - 3 salles : A ouverte à tous, Atelier restreinte (Karim + Inès),
 *   Cèdre exclusive (Camille) + 1 séance restreinte à l'Atelier ;
 * - 8 types de séances : mono/multi-déclinaisons, payante (Stripe),
 *   à validation, inactive ;
 * - dispos hebdo Lun→Sam, 1 congé jour entier, 1 absence partielle,
 *   1 ouverture exceptionnelle (samedi portes ouvertes, 2 praticiennes
 *   en parallèle dans 2 salles) ;
 * - ~40 réservations : confirmées, payées, en attente de validation,
 *   honorées, annulées (patient + praticienne), patiente revenante.
 *
 *   SQLITE_PATH=./local.db npm run db:push && npm run db:seed
 */

const TIMEZONE = "Europe/Paris";
const PASSWORD = process.env.SEED_PASSWORD ?? "demo-demo-1234";
const OFFICE_ID = "demo-office";

// ---------------------------------------------------------------------------
// Dates murales Europe/Paris
// ---------------------------------------------------------------------------

function addDaysStr(dateStr: string, delta: number): string {
  const [year, month, dayNum] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, dayNum + delta, 12))
    .toISOString()
    .slice(0, 10);
}

/** N-ième occurrence STRICTEMENT après aujourd'hui du jour `weekday` (0=dim). */
function futureWeekday(today: string, todayWeekday: number, weekday: number, occurrence: number): string {
  const delta = ((weekday - todayWeekday + 7) % 7 || 7) + (occurrence - 1) * 7;
  return addDaysStr(today, delta);
}

/** N-ième occurrence STRICTEMENT avant aujourd'hui du jour `weekday`. */
function pastWeekday(today: string, todayWeekday: number, weekday: number, occurrence: number): string {
  const delta = -(((todayWeekday - weekday + 7) % 7 || 7) + (occurrence - 1) * 7);
  return addDaysStr(today, delta);
}

// ---------------------------------------------------------------------------
// Reset + comptes
// ---------------------------------------------------------------------------

async function wipeAll(): Promise<void> {
  await db.delete(schema.booking);
  await db.delete(schema.practitionerGoogle);
  await db.delete(schema.invite);
  await db.delete(schema.exception);
  await db.delete(schema.availabilityRule);
  await db.delete(schema.sessionTypeRoom);
  await db.delete(schema.sessionTypeVariant);
  await db.delete(schema.sessionType);
  await db.delete(schema.roomMember);
  await db.delete(schema.room);
  await db.delete(schema.practitioner);
  await db.delete(schema.member);
  await db.delete(schema.office);
  await db.delete(schema.session);
  await db.delete(schema.account);
  await db.delete(schema.verification);
  await db.delete(schema.user);
}

async function ensureUser(fullName: string, email: string): Promise<string> {
  const created = (await auth.api.signUpEmail({
    body: { name: fullName, email, password: PASSWORD },
  })) as unknown as { user?: { id: string } };
  if (!created?.user) throw new Error(`signup impossible pour ${email}`);
  return created.user.id;
}

// ---------------------------------------------------------------------------
// Planificateur : attribue la première salle libre, décale sur la grille
// ---------------------------------------------------------------------------

interface VariantSpec {
  id: string;
  sessionTypeId: string;
  name: string;
  multi: boolean;
  durationMin: number;
  bufferAfterMin: number;
  priceDisplay: string | null;
  priceCents: number | null;
}

interface WindowSpec {
  weekday: number;
  start: string;
  end: string;
}

interface OffSpec {
  practitionerId: string;
  date: string;
  start: string | null;
  end: string | null;
  fullDay: boolean;
}

const MS_MIN = 60_000;

function toMin(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function toTime(totalMin: number): string {
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

interface Planner {
  variants: Map<string, VariantSpec>;
  steps: Map<string, number>;
  windows: Map<string, WindowSpec[]>;
  allowedRooms: Map<string, string[]>;
  extra: { practitionerId: string; date: string; start: string; end: string; roomId: string } | null;
  offs: OffSpec[];
  compatible: Map<string, string[] | null>;
  roomOf: (practitionerId: string, variantId: string, startMs: number, endMs: number, pinned: string | null) => string | null;
  pracBusy: Map<string, { start: number; end: number }[]>;
}

function overlaps(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}

function blockedByOff(planner: Planner, practitionerId: string, date: string, startMs: number, endMs: number): boolean {
  for (const off of planner.offs) {
    if (off.practitionerId !== practitionerId || off.date !== date) continue;
    if (off.fullDay) return true;
    const offStart = zonedTimeToUtc(date, off.start as string, TIMEZONE).getTime();
    const offEnd = zonedTimeToUtc(date, off.end as string, TIMEZONE).getTime();
    if (overlaps(startMs, endMs, offStart, offEnd)) return true;
  }
  return false;
}

interface PlannedSlot {
  start: Date;
  end: Date;
  roomId: string;
}

/**
 * Cherche un créneau le `date` donné à partir de `fromTime`, en décalant sur
 * la grille du praticien jusqu'à trouver praticien + salle libres.
 */
function planSlot(
  planner: Planner,
  practitionerId: string,
  variantId: string,
  date: string,
  fromTime: string,
  pinnedRoom: string | null = null,
): PlannedSlot {
  const variant = planner.variants.get(variantId);
  if (!variant) throw new Error(`variante inconnue ${variantId}`);
  const step = planner.steps.get(practitionerId) ?? 15;
  const dayWindows = (planner.windows.get(practitionerId) ?? []).filter(
    (window) => window.weekday === weekdayInTz(zonedTimeToUtc(date, "12:00", TIMEZONE), TIMEZONE),
  );
  const extra = planner.extra?.practitionerId === practitionerId && planner.extra.date === date ? planner.extra : null;
  const windows = extra
    ? [{ weekday: -1, start: extra.start, end: extra.end }]
    : dayWindows;
  if (windows.length === 0) throw new Error(`aucune dispo ${practitionerId} le ${date}`);

  const tried: string[] = [];
  for (const window of windows) {
    let cursor = Math.max(toMin(fromTime), toMin(window.start));
    const aligned = toMin(window.start) + Math.ceil((cursor - toMin(window.start)) / step) * step;
    cursor = aligned;
    while (toTime(cursor + variant.durationMin) <= window.end || (extra && toTime(cursor) <= window.end)) {
      const candidate = toTime(cursor);
      if (toMin(candidate) + variant.durationMin > toMin(window.end)) break;
      const start = zonedTimeToUtc(date, candidate, TIMEZONE);
      const end = new Date(start.getTime() + variant.durationMin * MS_MIN);
      const occupiedUntil = end.getTime() + variant.bufferAfterMin * MS_MIN;
      const busy = (planner.pracBusy.get(practitionerId) ?? []).some((slot) =>
        overlaps(start.getTime(), occupiedUntil, slot.start, slot.end),
      );
      if (!busy && !blockedByOff(planner, practitionerId, date, start.getTime(), occupiedUntil)) {
        const roomId = planner.roomOf(practitionerId, variantId, start.getTime(), occupiedUntil, pinnedRoom ?? extra?.roomId ?? null);
        if (roomId) {
          const busySlots = planner.pracBusy.get(practitionerId) ?? [];
          busySlots.push({ start: start.getTime(), end: occupiedUntil });
          planner.pracBusy.set(practitionerId, busySlots);
          return { start, end, roomId };
        }
      }
      tried.push(candidate);
      cursor += step;
    }
  }
  throw new Error(`aucun créneau ${practitionerId}/${variantId} le ${date} dès ${fromTime} (essayés : ${tried.join(", ")})`);
}

// ---------------------------------------------------------------------------
// Données
// ---------------------------------------------------------------------------

const PATIENTS: { first: string; last: string; email: string; phone: string | null }[] = [
  { first: "Sophie", last: "Martin", email: "sophie.martin@example.com", phone: "06 11 22 33 44" },
  { first: "Lucas", last: "Bernard", email: "lucas.bernard@example.com", phone: null },
  { first: "Emma", last: "Petit", email: "emma.petit@example.com", phone: "06 55 66 77 88" },
  { first: "Hugo", last: "Moreau", email: "hugo.moreau@example.com", phone: null },
  { first: "Chloé", last: "Dubois", email: "chloe.dubois@example.com", phone: "07 10 20 30 40" },
  { first: "Nathan", last: "Laurent", email: "nathan.laurent@example.com", phone: null },
  { first: "Sarah", last: "Michel", email: "sarah.michel@example.com", phone: "06 98 76 54 32" },
  { first: "Adam", last: "Garcia", email: "adam.garcia@example.com", phone: null },
  { first: "Manon", last: "Roux", email: "manon.roux@example.com", phone: "06 12 00 45 67" },
  { first: "Louis", last: "Fournier", email: "louis.fournier@example.com", phone: null },
  { first: "Jade", last: "Lambert", email: "jade.lambert@example.com", phone: null },
  { first: "Raphaël", last: "Fontaine", email: "raphael.fontaine@example.com", phone: "07 22 33 44 55" },
  { first: "Élise", last: "Rousseau", email: "elise.rousseau@example.com", phone: null },
  { first: "Théo", last: "Vincent", email: "theo.vincent@example.com", phone: "06 77 88 99 00" },
  { first: "Anna", last: "Muller", email: "anna.muller@example.com", phone: null },
  { first: "Léo", last: "Faure", email: "leo.faure@example.com", phone: null },
  { first: "Marie", last: "Dupont", email: "marie.dupont@example.com", phone: "06 33 44 55 66" },
  { first: "Julien", last: "Lefèvre", email: "julien.lefevre@example.com", phone: null },
  { first: "Pauline", last: "Girard", email: "pauline.girard@example.com", phone: null },
  { first: "Karim", last: "Haddad", email: "karim.haddad@example.com", phone: "07 44 55 66 77" },
];

async function main(): Promise<void> {
  const now = new Date();
  const today = dateStrInTz(now, TIMEZONE);
  const todayWeekday = weekdayInTz(now, TIMEZONE);
  const future = (weekday: number, occurrence = 1): string => futureWeekday(today, todayWeekday, weekday, occurrence);
  const past = (weekday: number, occurrence = 1): string => pastWeekday(today, todayWeekday, weekday, occurrence);

  await wipeAll();

  const camilleUser = await ensureUser("Camille Morel", "camille@example.com");
  const karimUser = await ensureUser("Karim Benali", "karim@example.com");
  const leaUser = await ensureUser("Léa Fontaine", "lea@example.com");
  const inesUser = await ensureUser("Inès Robert", "ines@example.com");

  // -- Cabinet -------------------------------------------------------------
  await db.insert(schema.office).values({
    id: OFFICE_ID,
    name: "Cabinet des Tilleuls",
    slug: "tilleuls",
    address: "12 rue des Lilas, 69007 Lyon",
    timezone: TIMEZONE,
    enablePractitionerPages: true,
    enableOfficePage: true,
    bookingLeadTimeMin: 120,
    cancelDeadlineHours: 24,
    reminderHoursBefore: 24,
    defaultBufferAfterMin: 0,
    themePalette: "sauge",
    themeMode: "system",
  });

  // -- Salles : A ouverte à tous, Atelier restreinte, Cèdre exclusive ------
  await db.insert(schema.room).values([
    { id: "demo-a", officeId: OFFICE_ID, name: "Salle A", color: "#4e7a5b", sortOrder: 0 },
    { id: "demo-atelier", officeId: OFFICE_ID, name: "Salle Atelier", color: "#96603a", sortOrder: 1 },
    { id: "demo-cedre", officeId: OFFICE_ID, name: "Salle Cèdre", color: "#3a6ea5", sortOrder: 2 },
  ]);

  await db.insert(schema.member).values([
    { id: "m-cam", officeId: OFFICE_ID, userId: camilleUser, role: "owner" },
    { id: "m-kar", officeId: OFFICE_ID, userId: karimUser, role: "practitioner" },
    { id: "m-lea", officeId: OFFICE_ID, userId: leaUser, role: "practitioner" },
    { id: "m-ine", officeId: OFFICE_ID, userId: inesUser, role: "practitioner" },
  ]);

  await db.insert(schema.practitioner).values([
    {
      id: "p-cam", officeId: OFFICE_ID, userId: camilleUser, displayName: "Camille Morel",
      slug: "camille", bio: "Sophrologie et accompagnement au bien-être.", publicContact: "camille@example.com",
      slotStepMin: 15, requiresValidationDefault: false,
      onsitePaymentMethods: JSON.stringify(["especes", "carte"]),
      onsitePaymentNote: "Règlement sur place, facture sur demande.",
    },
    {
      id: "p-kar", officeId: OFFICE_ID, userId: karimUser, displayName: "Karim Benali",
      slug: "karim", bio: "Massage bien-être, table chauffante et huiles bio.", publicContact: null,
      slotStepMin: 15, requiresValidationDefault: false,
      onsitePaymentMethods: JSON.stringify(["carte", "virement"]),
      onsitePaymentNote: "Acompte en ligne, solde sur place.",
    },
    {
      id: "p-lea", officeId: OFFICE_ID, userId: leaUser, displayName: "Léa Fontaine",
      slug: "lea", bio: "Réflexologie plantaire.", publicContact: null,
      slotStepMin: 30, requiresValidationDefault: false,
      onsitePaymentMethods: JSON.stringify(["especes"]),
      onsitePaymentNote: null,
    },
    {
      id: "p-ine", officeId: OFFICE_ID, userId: inesUser, displayName: "Inès Robert",
      slug: "ines", bio: "Hypnose ericksonienne. Chaque demande est relue avant confirmation.",
      publicContact: "ines@example.com",
      slotStepMin: 15, requiresValidationDefault: true,
      onsitePaymentMethods: JSON.stringify(["carte"]),
      onsitePaymentNote: null,
    },
  ]);

  await db.insert(schema.roomMember).values([
    { id: "rm-atelier-kar", roomId: "demo-atelier", practitionerId: "p-kar" },
    { id: "rm-atelier-ine", roomId: "demo-atelier", practitionerId: "p-ine" },
    { id: "rm-cedre-cam", roomId: "demo-cedre", practitionerId: "p-cam" },
  ]);

  // -- Séances ---------------------------------------------------------------
  await db.insert(schema.sessionType).values([
    { id: "st-cam-1", practitionerId: "p-cam", name: "Première séance", description: "Faisons connaissance et définissons votre accompagnement." },
    { id: "st-cam-2", practitionerId: "p-cam", name: "Suivi", description: null },
    { id: "st-cam-3", practitionerId: "p-cam", name: "Séance découverte", description: null, active: false },
    { id: "st-kar-1", practitionerId: "p-kar", name: "Massage bien-être", description: "Massage du corps, au choix 60 ou 90 minutes.", requiresPayment: true, currency: "eur" },
    { id: "st-lea-1", practitionerId: "p-lea", name: "Découverte", description: null },
    { id: "st-lea-2", practitionerId: "p-lea", name: "Séance complète", description: null },
    { id: "st-ine-1", practitionerId: "p-ine", name: "Hypnose", description: "Séance d'hypnose ericksonienne, validée à la main.", requiresValidation: true },
    { id: "st-ine-2", practitionerId: "p-ine", name: "Premier échange", description: "20 minutes offertes pour faire connaissance.", requiresValidation: true },
  ]);
  await db.insert(schema.sessionTypeVariant).values([
    { id: "stv-cam-1a", sessionTypeId: "st-cam-1", durationMin: 60, bufferAfterMin: 15, priceDisplay: "70 €", sortOrder: 0 },
    { id: "stv-cam-2a", sessionTypeId: "st-cam-2", durationMin: 45, bufferAfterMin: 10, priceDisplay: "60 €", sortOrder: 0 },
    { id: "stv-cam-3a", sessionTypeId: "st-cam-3", durationMin: 30, bufferAfterMin: 10, priceDisplay: "30 €", sortOrder: 0 },
    { id: "stv-kar-1a", sessionTypeId: "st-kar-1", durationMin: 60, bufferAfterMin: 10, priceDisplay: "60 €", priceCents: 6000, sortOrder: 0 },
    { id: "stv-kar-1b", sessionTypeId: "st-kar-1", durationMin: 90, bufferAfterMin: 15, priceDisplay: "80 €", priceCents: 8000, sortOrder: 1 },
    { id: "stv-lea-1a", sessionTypeId: "st-lea-1", durationMin: 30, bufferAfterMin: 10, priceDisplay: "35 €", sortOrder: 0 },
    { id: "stv-lea-2a", sessionTypeId: "st-lea-2", durationMin: 60, bufferAfterMin: 15, priceDisplay: "60 €", sortOrder: 0 },
    { id: "stv-ine-1a", sessionTypeId: "st-ine-1", durationMin: 60, bufferAfterMin: 15, priceDisplay: "65 €", sortOrder: 0 },
    { id: "stv-ine-2a", sessionTypeId: "st-ine-2", durationMin: 20, bufferAfterMin: 10, priceDisplay: "Offert", sortOrder: 0 },
  ]);
  // Massage bien-être : salle Atelier uniquement (table équipée).
  await db.insert(schema.sessionTypeRoom).values([
    { id: "str-kar-atelier", sessionTypeId: "st-kar-1", roomId: "demo-atelier" },
  ]);

  // -- Dispos hebdo ------------------------------------------------------------
  const rules: { id: string; practitionerId: string; weekday: number; startTime: string; endTime: string }[] = [
    { id: "ar-cam-lun", practitionerId: "p-cam", weekday: 1, startTime: "09:00", endTime: "12:00" },
    { id: "ar-cam-mer", practitionerId: "p-cam", weekday: 3, startTime: "09:00", endTime: "12:00" },
    { id: "ar-cam-mar", practitionerId: "p-cam", weekday: 2, startTime: "14:00", endTime: "18:00" },
    { id: "ar-kar-lun", practitionerId: "p-kar", weekday: 1, startTime: "14:00", endTime: "18:00" },
    { id: "ar-kar-mer", practitionerId: "p-kar", weekday: 3, startTime: "14:00", endTime: "18:00" },
    { id: "ar-kar-jeu", practitionerId: "p-kar", weekday: 4, startTime: "09:00", endTime: "12:00" },
    { id: "ar-lea-mer", practitionerId: "p-lea", weekday: 3, startTime: "09:00", endTime: "12:00" },
    { id: "ar-lea-ven", practitionerId: "p-lea", weekday: 5, startTime: "09:00", endTime: "12:00" },
    { id: "ar-lea-sam", practitionerId: "p-lea", weekday: 6, startTime: "09:00", endTime: "12:00" },
    { id: "ar-ine-mar", practitionerId: "p-ine", weekday: 2, startTime: "09:00", endTime: "12:00" },
    { id: "ar-ine-jeu", practitionerId: "p-ine", weekday: 4, startTime: "14:00", endTime: "18:00" },
    { id: "ar-ine-ven", practitionerId: "p-ine", weekday: 5, startTime: "14:00", endTime: "17:00" },
  ];
  await db.insert(schema.availabilityRule).values(rules);

  // -- Exceptions : congé, formation, portes ouvertes ---------------------------
  const congresDay = future(3, 1);
  const formationDay = future(4, 1);
  const portesOuvertesDay = future(6, 1);
  const congeLeaDay = future(5, 2);
  await db.insert(schema.exception).values([
    { id: "ex-cam-congres", practitionerId: "p-cam", date: congresDay, kind: "off", fullDay: true, reason: "Congrès bien-être" },
    { id: "ex-kar-form", practitionerId: "p-kar", date: formationDay, kind: "off", startTime: "09:00", endTime: "10:30", fullDay: false, reason: "Formation" },
    { id: "ex-ine-extra", practitionerId: "p-ine", date: portesOuvertesDay, kind: "extra", startTime: "09:00", endTime: "12:00", fullDay: false, roomId: "demo-atelier", reason: "Portes ouvertes" },
    { id: "ex-lea-conge", practitionerId: "p-lea", date: congeLeaDay, kind: "off", fullDay: true, reason: "Congés" },
  ]);

  // -- Invitation en attente ------------------------------------------------------
  await db.insert(schema.invite).values({
    id: "demo-inv-1",
    officeId: OFFICE_ID,
    email: "nadia.haddad@example.com",
    role: "practitioner",
    token: randomBytes(16).toString("hex"),
    expiresAt: new Date(now.getTime() + 7 * 24 * 3_600_000),
    invitedByUserId: camilleUser,
  });

  // -- Planificateur ---------------------------------------------------------------
  const variantSpecs: VariantSpec[] = [
    { id: "stv-cam-1a", sessionTypeId: "st-cam-1", name: "Première séance", multi: false, durationMin: 60, bufferAfterMin: 15, priceDisplay: "70 €", priceCents: null },
    { id: "stv-cam-2a", sessionTypeId: "st-cam-2", name: "Suivi", multi: false, durationMin: 45, bufferAfterMin: 10, priceDisplay: "60 €", priceCents: null },
    { id: "stv-kar-1a", sessionTypeId: "st-kar-1", name: "Massage bien-être", multi: true, durationMin: 60, bufferAfterMin: 10, priceDisplay: "60 €", priceCents: 6000 },
    { id: "stv-kar-1b", sessionTypeId: "st-kar-1", name: "Massage bien-être", multi: true, durationMin: 90, bufferAfterMin: 15, priceDisplay: "80 €", priceCents: 8000 },
    { id: "stv-lea-1a", sessionTypeId: "st-lea-1", name: "Découverte", multi: false, durationMin: 30, bufferAfterMin: 10, priceDisplay: "35 €", priceCents: null },
    { id: "stv-lea-2a", sessionTypeId: "st-lea-2", name: "Séance complète", multi: false, durationMin: 60, bufferAfterMin: 15, priceDisplay: "60 €", priceCents: null },
    { id: "stv-ine-1a", sessionTypeId: "st-ine-1", name: "Hypnose", multi: false, durationMin: 60, bufferAfterMin: 15, priceDisplay: "65 €", priceCents: null },
    { id: "stv-ine-2a", sessionTypeId: "st-ine-2", name: "Premier échange", multi: false, durationMin: 20, bufferAfterMin: 10, priceDisplay: "Offert", priceCents: null },
  ];
  const allowedRooms = new Map<string, string[]>([
    ["p-cam", ["demo-a", "demo-cedre"]],
    ["p-kar", ["demo-a", "demo-atelier"]],
    ["p-lea", ["demo-a"]],
    ["p-ine", ["demo-a", "demo-atelier"]],
  ]);
  const compatibleRooms = new Map<string, string[] | null>([
    ["st-kar-1", ["demo-atelier"]],
  ]);
  const roomBusy = new Map<string, { start: number; end: number }[]>([
    ["demo-a", []], ["demo-atelier", []], ["demo-cedre", []],
  ]);
  const windows = new Map<string, WindowSpec[]>();
  for (const rule of rules) {
    const list = windows.get(rule.practitionerId) ?? [];
    list.push({ weekday: rule.weekday, start: rule.startTime, end: rule.endTime });
    windows.set(rule.practitionerId, list);
  }
  const planner: Planner = {
    variants: new Map(variantSpecs.map((spec) => [spec.id, spec])),
    steps: new Map([["p-cam", 15], ["p-kar", 15], ["p-lea", 30], ["p-ine", 15]]),
    windows,
    allowedRooms,
    extra: { practitionerId: "p-ine", date: portesOuvertesDay, start: "09:00", end: "12:00", roomId: "demo-atelier" },
    offs: [
      { practitionerId: "p-cam", date: congresDay, start: null, end: null, fullDay: true },
      { practitionerId: "p-kar", date: formationDay, start: "09:00", end: "10:30", fullDay: false },
      { practitionerId: "p-lea", date: congeLeaDay, start: null, end: null, fullDay: true },
    ],
    compatible: compatibleRooms,
    pracBusy: new Map([["p-cam", []], ["p-kar", []], ["p-lea", []], ["p-ine", []]]),
    roomOf: (practitionerId, variantId, startMs, endMs, pinned) => {
      if (pinned) {
        const busy = roomBusy.get(pinned) ?? [];
        if (busy.some((slot) => overlaps(startMs, endMs, slot.start, slot.end))) return null;
        busy.push({ start: startMs, end: endMs });
        return pinned;
      }
      // Première salle libre parmi (autorisées ∩ compatibles), ordre
      // déterministe (tri des salles). Extra : salle imposée.
      const compatible = planner.compatible.get(
        variantSpecs.find((spec) => spec.id === variantId)?.sessionTypeId ?? "",
      ) ?? null;
      const candidates = (allowedRooms.get(practitionerId) ?? []).filter(
        (roomId) => !compatible || compatible.includes(roomId),
      );
      for (const roomId of roomOrder.filter((roomId) => candidates.includes(roomId))) {
        const busy = roomBusy.get(roomId) ?? [];
        if (busy.some((slot) => overlaps(startMs, endMs, slot.start, slot.end))) continue;
        busy.push({ start: startMs, end: endMs });
        return roomId;
      }
      return null;
    },
  };
  const roomOrder = ["demo-a", "demo-atelier", "demo-cedre"];

  interface BookingPlan {
    practitionerId: string;
    variantId: string;
    date: string;
    time: string;
    patient: number;
    status: "confirmed" | "completed" | "cancelled" | "pending";
    room?: string;
    paid?: boolean;
    validation?: boolean;
    cancelledBy?: string;
    cancelReason?: string | null;
    notes?: string | null;
  }
  const plans: BookingPlan[] = [
    // ---- Futur : agenda rempli (3 semaines) ----
    { practitionerId: "p-cam", variantId: "stv-cam-2a", date: future(1, 1), time: "09:00", patient: 0, status: "confirmed", notes: "Première visite, un peu stressée." },
    { practitionerId: "p-cam", variantId: "stv-cam-1a", date: future(1, 1), time: "10:00", patient: 1, status: "confirmed" },
    { practitionerId: "p-kar", variantId: "stv-kar-1a", date: future(1, 1), time: "14:00", patient: 2, status: "confirmed", paid: true },
    { practitionerId: "p-kar", variantId: "stv-kar-1b", date: future(1, 1), time: "15:30", patient: 3, status: "confirmed", paid: true, notes: "Préfère une salle calme." },
    { practitionerId: "p-ine", variantId: "stv-ine-1a", date: future(2, 1), time: "09:00", patient: 4, status: "confirmed" },
    { practitionerId: "p-ine", variantId: "stv-ine-2a", date: future(2, 1), time: "10:30", patient: 5, status: "confirmed" },
    { practitionerId: "p-cam", variantId: "stv-cam-2a", date: future(2, 1), time: "14:00", patient: 6, status: "confirmed" },
    { practitionerId: "p-cam", variantId: "stv-cam-1a", date: future(2, 1), time: "15:00", patient: 7, status: "confirmed", room: "demo-cedre" },
    { practitionerId: "p-lea", variantId: "stv-lea-1a", date: future(3, 1), time: "09:00", patient: 8, status: "confirmed" },
    { practitionerId: "p-lea", variantId: "stv-lea-2a", date: future(3, 1), time: "10:00", patient: 9, status: "confirmed", notes: "Mal de dos persistant." },
    { practitionerId: "p-kar", variantId: "stv-kar-1a", date: future(3, 1), time: "14:00", patient: 10, status: "confirmed", paid: true },
    { practitionerId: "p-kar", variantId: "stv-kar-1a", date: future(4, 1), time: "11:00", patient: 11, status: "confirmed", paid: true },
    { practitionerId: "p-ine", variantId: "stv-ine-1a", date: future(4, 1), time: "14:00", patient: 12, status: "confirmed" },
    { practitionerId: "p-ine", variantId: "stv-ine-1a", date: future(4, 1), time: "15:30", patient: 13, status: "confirmed", room: "demo-atelier" },
    { practitionerId: "p-lea", variantId: "stv-lea-1a", date: future(5, 1), time: "09:00", patient: 14, status: "confirmed" },
    { practitionerId: "p-lea", variantId: "stv-lea-2a", date: future(5, 1), time: "10:00", patient: 15, status: "confirmed" },
    { practitionerId: "p-ine", variantId: "stv-ine-1a", date: future(5, 1), time: "14:00", patient: 16, status: "confirmed" },
    // Portes ouvertes : Léa (récurrent) + Inès (extra) en parallèle, 2 salles.
    { practitionerId: "p-lea", variantId: "stv-lea-1a", date: portesOuvertesDay, time: "09:00", patient: 17, status: "confirmed" },
    { practitionerId: "p-ine", variantId: "stv-ine-1a", date: portesOuvertesDay, time: "09:00", patient: 18, status: "confirmed" },
    { practitionerId: "p-ine", variantId: "stv-ine-1a", date: portesOuvertesDay, time: "10:30", patient: 19, status: "confirmed" },
    // Semaine +2
    { practitionerId: "p-kar", variantId: "stv-kar-1b", date: future(4, 2), time: "09:30", patient: 0, status: "confirmed", paid: true },
    { practitionerId: "p-cam", variantId: "stv-cam-2a", date: future(1, 2), time: "09:30", patient: 4, status: "confirmed" },
    { practitionerId: "p-cam", variantId: "stv-cam-1a", date: future(3, 2), time: "09:30", patient: 6, status: "confirmed" },
    // En attente de validation (Inès)
    { practitionerId: "p-ine", variantId: "stv-ine-1a", date: future(2, 2), time: "09:30", patient: 8, status: "pending", validation: true, notes: "Envie d'arrêter de fumer." },
    { practitionerId: "p-ine", variantId: "stv-ine-2a", date: future(5, 2), time: "15:00", patient: 10, status: "pending", validation: true },
    // Annulé à venir (patiente, dans les délais)
    { practitionerId: "p-lea", variantId: "stv-lea-2a", date: future(6, 2), time: "10:00", patient: 12, status: "cancelled", cancelledBy: "patient", cancelReason: "Empêchement familial" },
    // ---- Passé : historique + stats ----
    { practitionerId: "p-cam", variantId: "stv-cam-1a", date: past(1, 1), time: "09:00", patient: 0, status: "completed" },
    { practitionerId: "p-cam", variantId: "stv-cam-2a", date: past(2, 1), time: "14:30", patient: 2, status: "completed" },
    { practitionerId: "p-kar", variantId: "stv-kar-1b", date: past(1, 1), time: "14:30", patient: 4, status: "completed", paid: true },
    { practitionerId: "p-kar", variantId: "stv-kar-1a", date: past(4, 1), time: "10:00", patient: 6, status: "completed", paid: true },
    { practitionerId: "p-lea", variantId: "stv-lea-1a", date: past(5, 1), time: "09:30", patient: 8, status: "completed" },
    { practitionerId: "p-lea", variantId: "stv-lea-2a", date: past(6, 1), time: "09:30", patient: 10, status: "completed" },
    { practitionerId: "p-ine", variantId: "stv-ine-1a", date: past(2, 1), time: "09:00", patient: 12, status: "completed", validation: true },
    { practitionerId: "p-ine", variantId: "stv-ine-1a", date: past(4, 1), time: "16:00", patient: 14, status: "completed", validation: true },
    { practitionerId: "p-cam", variantId: "stv-cam-2a", date: past(3, 2), time: "10:00", patient: 16, status: "completed" },
    { practitionerId: "p-kar", variantId: "stv-kar-1a", date: past(3, 2), time: "15:00", patient: 18, status: "completed", paid: true },
    { practitionerId: "p-lea", variantId: "stv-lea-1a", date: past(3, 2), time: "11:00", patient: 1, status: "completed" },
    { practitionerId: "p-ine", variantId: "stv-ine-2a", date: past(5, 2), time: "14:30", patient: 3, status: "completed", validation: true },
    { practitionerId: "p-lea", variantId: "stv-lea-1a", date: past(6, 2), time: "09:00", patient: 5, status: "completed" },
    { practitionerId: "p-cam", variantId: "stv-cam-2a", date: past(1, 3), time: "09:00", patient: 7, status: "completed" },
    { practitionerId: "p-kar", variantId: "stv-kar-1a", date: past(4, 3), time: "09:00", patient: 9, status: "completed", paid: true },
    { practitionerId: "p-ine", variantId: "stv-ine-1a", date: past(4, 3), time: "14:30", patient: 11, status: "completed", validation: true },
    { practitionerId: "p-lea", variantId: "stv-lea-2a", date: past(5, 3), time: "10:30", patient: 13, status: "completed" },
    // Annulés passés
    { practitionerId: "p-cam", variantId: "stv-cam-2a", date: past(2, 2), time: "15:30", patient: 15, status: "cancelled", cancelledBy: "practitioner", cancelReason: "Formation — créneau déplacé à la semaine suivante" },
    { practitionerId: "p-kar", variantId: "stv-kar-1a", date: past(1, 3), time: "16:00", patient: 17, status: "cancelled", cancelledBy: "patient", cancelReason: "Empêchement" },
    { practitionerId: "p-lea", variantId: "stv-lea-1a", date: past(6, 1), time: "11:00", patient: 19, status: "cancelled", cancelledBy: "patient", cancelReason: "Grippe" },
    { practitionerId: "p-ine", variantId: "stv-ine-1a", date: past(2, 3), time: "11:00", patient: 5, status: "cancelled", cancelledBy: "practitioner", cancelReason: "Urgence personnelle" },
  ];

  let bookingIndex = 0;
  let paidIndex = 0;
  for (const plan of plans) {
    const slot = planSlot(planner, plan.practitionerId, plan.variantId, plan.date, plan.time, plan.room ?? null);
    const spec = planner.variants.get(plan.variantId) as VariantSpec;
    const patient = PATIENTS[plan.patient % PATIENTS.length];
    bookingIndex += 1;
    const isPast = slot.start.getTime() < now.getTime();
    const needsValidation = plan.validation ?? false;
    const isPaid = plan.paid ?? false;
    await db.insert(schema.booking).values({
      id: `demo-b-${String(bookingIndex).padStart(2, "0")}`,
      officeId: OFFICE_ID,
      practitionerId: plan.practitionerId,
      roomId: slot.roomId,
      sessionTypeId: spec.sessionTypeId,
      sessionVariantId: spec.id,
      sessionNameSnapshot: spec.multi ? `${spec.name} (${spec.durationMin} min)` : spec.name,
      durationMinSnapshot: spec.durationMin,
      bufferAfterMinSnapshot: spec.bufferAfterMin,
      priceCentsSnapshot: spec.priceCents,
      priceDisplaySnapshot: spec.priceDisplay,
      currencySnapshot: "eur",
      startAt: slot.start,
      endAt: slot.end,
      patientFirstName: patient.first,
      patientLastName: patient.last,
      patientEmail: patient.email,
      patientPhone: patient.phone,
      notes: plan.notes ?? null,
      status: plan.status,
      paymentStatus: isPaid ? "paid" : "none",
      stripeSessionId: isPaid ? `cs_demo_${Date.now()}_${(paidIndex += 1)}` : null,
      validationRequired: needsValidation,
      validatedAt: plan.status === "completed" && needsValidation ? new Date(slot.start.getTime() - 2 * 24 * 3_600_000) : null,
      pendingExpiresAt: null,
      cancelToken: randomBytes(32).toString("hex"),
      rescheduleToken: randomBytes(32).toString("hex"),
      reminderSentAt: plan.status === "completed" ? new Date(slot.start.getTime() - 24 * 3_600_000) : null,
      cancelledAt: plan.status === "cancelled" ? new Date(Math.min(now.getTime(), slot.start.getTime()) - 3 * 24 * 3_600_000) : null,
      cancelReason: plan.cancelReason ?? null,
      cancelledBy: plan.cancelledBy ?? null,
    });
    void isPast;
  }

  console.log("✓ Seed démo appliqué (base remise à zéro, mot de passe : %s)", PASSWORD);
  console.log("  Comptes : camille / karim / lea / ines @example.com (owner : camille)");
  console.log("  Cabinet : http://localhost:3000/o/tilleuls");
  console.log("  Pages : /p/camille, /p/karim, /p/lea, /p/ines");
  console.log("  %d réservations (%s…%s), congé Camille le %s, portes ouvertes le %s",
    plans.length, past(5, 3), future(6, 2), congresDay, portesOuvertesDay);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
