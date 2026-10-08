import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

/**
 * Schéma SQLite.
 * Tables `user`/`session`/`account`/`verification` attendues par better-auth,
 * plus les tables métier (SPEC.md §6) : office, member, practitioner, room,
 * room_member, session_type, availability_rule, exception, booking.
 *
 * Les heures murales sont stockées en texte ("HH:MM", "YYYY-MM-DD"), les
 * instants absolus en epoch (`mode: "timestamp"`, UTC). L'affichage se fait
 * toujours en Europe/Paris (voir SPEC.md §F7).
 */

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
};

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

// ---------------------------------------------------------------------------
// Better Auth
// ---------------------------------------------------------------------------

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", {
    mode: "timestamp",
  }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", {
    mode: "timestamp",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(unixepoch())`,
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(
    sql`(unixepoch())`,
  ),
});

// ---------------------------------------------------------------------------
// Métier
// ---------------------------------------------------------------------------

export const office = sqliteTable("office", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  address: text("address"),
  timezone: text("timezone").notNull().default("Europe/Paris"),
  enablePractitionerPages: integer("enable_practitioner_pages", {
    mode: "boolean",
  })
    .notNull()
    .default(true),
  enableOfficePage: integer("enable_office_page", { mode: "boolean" })
    .notNull()
    .default(false),
  // Abonnement SaaS (1 par cabinet, payé par le owner) : customer + abo Stripe.
  // `subscriptionStatus` suit les statuts Stripe (trialing/active/past_due/canceled…).
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionStatus: text("subscription_status"),
  subscriptionCurrentPeriodEnd: integer("subscription_current_period_end", { mode: "timestamp" }),
  bookingLeadTimeMin: integer("booking_lead_time_min").notNull().default(120),
  cancelDeadlineHours: integer("cancel_deadline_hours").notNull().default(24),
  reminderHoursBefore: integer("reminder_hours_before").notNull().default(24),
  defaultBufferAfterMin: integer("default_buffer_after_min")
    .notNull()
    .default(0),
  // Ambiance des pages publiques (palette vue par les patients).
  themePalette: text("theme_palette").notNull().default("sauge"),
  // Mode forcé des pages publiques ('system' = suit l'appareil du patient).
  themeMode: text("theme_mode").notNull().default("system"),
  ...timestamps,
});

export const member = sqliteTable(
  "member",
  {
    id: id(),
    officeId: text("office_id")
      .notNull()
      .references(() => office.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("practitioner"), // 'owner' | 'practitioner'
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("member_office_user_idx").on(t.officeId, t.userId)],
);

export const practitioner = sqliteTable(
  "practitioner",
  {
    id: id(),
    officeId: text("office_id")
      .notNull()
      .references(() => office.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    slug: text("slug").notNull().unique(),
    bio: text("bio"),
    publicContact: text("public_contact"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    // Pas de la grille de créneaux coulissante (minutes, 5..120, défaut 15).
    // La grille est ancrée au début de chaque fenêtre ; tout départ multiple
    // du pas qui tient dans la fenêtre est proposé (SPEC.md §F7).
    slotStepMin: integer("slot_step_min").notNull().default(15),
    // Défaut praticien pour la validation manuelle : pré-remplit
    // `requiresValidation` à la création d'un type de séance (option A :
    // les séances existantes gardent leur valeur, modifiable une par une).
    requiresValidationDefault: integer("requires_validation_default", { mode: "boolean" })
      .notNull()
      .default(false),
    // Stripe Connect Express (destination charges) : un compte par praticien.
    // Null tant que le praticien n'a pas lié son compte Stripe.
    stripeAccountId: text("stripe_account_id"),
    stripeChargesEnabled: integer("stripe_charges_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    stripePayoutsEnabled: integer("stripe_payouts_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    ...timestamps,
  },
  (t) => [index("practitioner_office_idx").on(t.officeId)],
);

export const room = sqliteTable(
  "room",
  {
    id: id(),
    officeId: text("office_id")
      .notNull()
      .references(() => office.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#4e7a5b"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("room_office_idx").on(t.officeId)],
);

/** Allowlist salle ↔ praticien. Zéro ligne pour une salle = ouverte à tous. */
export const roomMember = sqliteTable(
  "room_member",
  {
    id: id(),
    roomId: text("room_id")
      .notNull()
      .references(() => room.id, { onDelete: "cascade" }),
    practitionerId: text("practitioner_id")
      .notNull()
      .references(() => practitioner.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("room_member_idx").on(t.roomId, t.practitionerId)],
);

export const sessionType = sqliteTable(
  "session_type",
  {
    id: id(),
    practitionerId: text("practitioner_id")
      .notNull()
      .references(() => practitioner.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    durationMin: integer("duration_min").notNull(),
    bufferAfterMin: integer("buffer_after_min").notNull().default(0),
    priceDisplay: text("price_display"), // affichage seul, aucun paiement
    // Paiement Stripe : si requiresPayment, priceCents (> 0) est débité.
    requiresPayment: integer("requires_payment", { mode: "boolean" })
      .notNull()
      .default(false),
    priceCents: integer("price_cents"),
    currency: text("currency").notNull().default("eur"),
    // Validation praticien : si vrai, le RDV reste `pending` jusqu'à validation.
    requiresValidation: integer("requires_validation", { mode: "boolean" })
      .notNull()
      .default(false),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (t) => [index("session_type_practitioner_idx").on(t.practitionerId)],
);

/**
 * Salles compatibles par type de séance. Zéro ligne = toutes les salles
 * autorisées au praticien (pas de restriction).
 */
export const sessionTypeRoom = sqliteTable(
  "session_type_room",
  {
    id: id(),
    sessionTypeId: text("session_type_id")
      .notNull()
      .references(() => sessionType.id, { onDelete: "cascade" }),
    roomId: text("room_id")
      .notNull()
      .references(() => room.id, { onDelete: "restrict" }),
  },
  (t) => [uniqueIndex("session_type_room_idx").on(t.sessionTypeId, t.roomId)],
);

export const availabilityRule = sqliteTable(
  "availability_rule",
  {
    id: id(),
    practitionerId: text("practitioner_id")
      .notNull()
      .references(() => practitioner.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(), // 0 = dimanche … 6 = samedi
    startTime: text("start_time").notNull(), // "HH:MM"
    endTime: text("end_time").notNull(), // "HH:MM"
    // Pas de salle : la plage déclare une disponibilité du praticien, la
    // salle est attribuée à la réservation (première salle autorisée libre).
  },
  (t) => [index("availability_practitioner_idx").on(t.practitionerId)],
);

export const exception = sqliteTable(
  "exception",
  {
    id: id(),
    practitionerId: text("practitioner_id")
      .notNull()
      .references(() => practitioner.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // "YYYY-MM-DD"
    kind: text("kind").notNull(), // 'off' | 'extra'
    startTime: text("start_time"), // "HH:MM", null si fullDay (off)
    endTime: text("end_time"),
    fullDay: integer("full_day", { mode: "boolean" }).notNull().default(false),
    roomId: text("room_id").references(() => room.id, {
      onDelete: "restrict",
    }), // requis si kind = 'extra'
    reason: text("reason"),
  },
  (t) => [index("exception_practitioner_date_idx").on(t.practitionerId, t.date)],
);

export const invite = sqliteTable(
  "invite",
  {
    id: id(),
    officeId: text("office_id")
      .notNull()
      .references(() => office.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull().default("practitioner"), // 'owner' | 'practitioner'
    token: text("token").notNull().unique(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp" }),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [index("invite_office_idx").on(t.officeId)],
);

export const booking = sqliteTable(
  "booking",
  {
    id: id(),
    officeId: text("office_id")
      .notNull()
      .references(() => office.id, { onDelete: "cascade" }),
    practitionerId: text("practitioner_id")
      .notNull()
      .references(() => practitioner.id, { onDelete: "cascade" }),
    roomId: text("room_id")
      .notNull()
      .references(() => room.id, { onDelete: "restrict" }),
    sessionTypeId: text("session_type_id")
      // Traçabilité : la suppression d'un type met les références à NULL
      // (pas de cascade) ; l'affichage utilise les snapshots ci-dessous.
      .references(() => sessionType.id, { onDelete: "set null" }),
    // Snapshots au moment de la réservation (les types peuvent changer après).
    sessionNameSnapshot: text("session_name_snapshot").notNull(),
    durationMinSnapshot: integer("duration_min_snapshot").notNull(),
    bufferAfterMinSnapshot: integer("buffer_after_min_snapshot")
      .notNull()
      .default(0),
    startAt: integer("start_at", { mode: "timestamp" }).notNull(),
    endAt: integer("end_at", { mode: "timestamp" }).notNull(),
    patientFirstName: text("patient_first_name").notNull(),
    patientLastName: text("patient_last_name").notNull(),
    patientEmail: text("patient_email").notNull(),
    patientPhone: text("patient_phone"),
    notes: text("notes"),
    status: text("status").notNull().default("confirmed"), // 'pending' | 'confirmed' | 'cancelled' | 'completed'
    // Paiement + validation (ne concernent que le flux avec acompte/validation).
    paymentStatus: text("payment_status").notNull().default("none"), // 'none' | 'pending' | 'paid'
    stripeSessionId: text("stripe_session_id").unique(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    validationRequired: integer("validation_required", { mode: "boolean" })
      .notNull()
      .default(false),
    validatedAt: integer("validated_at", { mode: "timestamp" }),
    pendingExpiresAt: integer("pending_expires_at", { mode: "timestamp" }),
    cancelToken: text("cancel_token").notNull().unique(),
    rescheduleToken: text("reschedule_token").notNull().unique(),
    reminderSentAt: integer("reminder_sent_at", { mode: "timestamp" }),
    cancelledAt: integer("cancelled_at", { mode: "timestamp" }),
    cancelReason: text("cancel_reason"),
    // Push Google Agenda (outbound, par praticien) : identifiant de
    // l'événement chez Google + état de la synchro (retry best-effort).
    googleEventId: text("google_event_id").unique(),
    googleSyncStatus: text("google_sync_status").notNull().default("none"), // 'none' | 'pending' | 'ok' | 'error'
    googleSyncError: text("google_sync_error"),
    ...timestamps,
  },
  (t) => [
    index("booking_practitioner_start_idx").on(t.practitionerId, t.startAt),
    index("booking_room_start_idx").on(t.roomId, t.startAt),
  ],
);

/**
 * Préférences de push Google Agenda par praticien (outbound uniquement).
 * `showPatientName` = opt-in explicite : par défaut les événements Google
 * sont anonymisés ("Réservé"), sans nom ni contact patient.
 */
export const practitionerGoogle = sqliteTable("practitioner_google", {
  practitionerId: text("practitioner_id")
    .primaryKey()
    .references(() => practitioner.id, { onDelete: "cascade" }),
  syncEnabled: integer("sync_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  calendarId: text("calendar_id").notNull().default("primary"),
  showPatientName: integer("show_patient_name", { mode: "boolean" })
    .notNull()
    .default(false),
  lastSyncAt: integer("last_sync_at", { mode: "timestamp" }),
  lastError: text("last_error"),
  ...timestamps,
});
