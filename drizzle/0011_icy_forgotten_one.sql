PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_booking` (
	`id` text PRIMARY KEY NOT NULL,
	`office_id` text NOT NULL,
	`practitioner_id` text NOT NULL,
	`room_id` text NOT NULL,
	`session_type_id` text,
	`session_name_snapshot` text NOT NULL,
	`duration_min_snapshot` integer NOT NULL,
	`buffer_after_min_snapshot` integer DEFAULT 0 NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`patient_first_name` text NOT NULL,
	`patient_last_name` text NOT NULL,
	`patient_email` text NOT NULL,
	`patient_phone` text,
	`notes` text,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`payment_status` text DEFAULT 'none' NOT NULL,
	`stripe_session_id` text,
	`stripe_payment_intent_id` text,
	`validation_required` integer DEFAULT false NOT NULL,
	`validated_at` integer,
	`pending_expires_at` integer,
	`cancel_token` text NOT NULL,
	`reschedule_token` text NOT NULL,
	`reminder_sent_at` integer,
	`cancelled_at` integer,
	`cancel_reason` text,
	`google_event_id` text,
	`google_sync_status` text DEFAULT 'none' NOT NULL,
	`google_sync_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`office_id`) REFERENCES `office`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`practitioner_id`) REFERENCES `practitioner`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `room`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`session_type_id`) REFERENCES `session_type`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_booking`("id", "office_id", "practitioner_id", "room_id", "session_type_id", "session_name_snapshot", "duration_min_snapshot", "buffer_after_min_snapshot", "start_at", "end_at", "patient_first_name", "patient_last_name", "patient_email", "patient_phone", "notes", "status", "payment_status", "stripe_session_id", "stripe_payment_intent_id", "validation_required", "validated_at", "pending_expires_at", "cancel_token", "reschedule_token", "reminder_sent_at", "cancelled_at", "cancel_reason", "google_event_id", "google_sync_status", "google_sync_error", "created_at", "updated_at") SELECT "id", "office_id", "practitioner_id", "room_id", "session_type_id", "session_name_snapshot", "duration_min_snapshot", "buffer_after_min_snapshot", "start_at", "end_at", "patient_first_name", "patient_last_name", "patient_email", "patient_phone", "notes", "status", "payment_status", "stripe_session_id", "stripe_payment_intent_id", "validation_required", "validated_at", "pending_expires_at", "cancel_token", "reschedule_token", "reminder_sent_at", "cancelled_at", "cancel_reason", "google_event_id", "google_sync_status", "google_sync_error", "created_at", "updated_at" FROM `booking`;--> statement-breakpoint
DROP TABLE `booking`;--> statement-breakpoint
ALTER TABLE `__new_booking` RENAME TO `booking`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `booking_stripe_session_id_unique` ON `booking` (`stripe_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `booking_cancel_token_unique` ON `booking` (`cancel_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `booking_reschedule_token_unique` ON `booking` (`reschedule_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `booking_google_event_id_unique` ON `booking` (`google_event_id`);--> statement-breakpoint
CREATE INDEX `booking_practitioner_start_idx` ON `booking` (`practitioner_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `booking_room_start_idx` ON `booking` (`room_id`,`start_at`);