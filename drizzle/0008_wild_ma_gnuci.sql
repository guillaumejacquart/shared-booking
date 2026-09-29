CREATE TABLE `practitioner_google` (
	`practitioner_id` text PRIMARY KEY NOT NULL,
	`sync_enabled` integer DEFAULT false NOT NULL,
	`calendar_id` text DEFAULT 'primary' NOT NULL,
	`show_patient_name` integer DEFAULT false NOT NULL,
	`last_sync_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`practitioner_id`) REFERENCES `practitioner`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `booking` ADD `google_event_id` text;--> statement-breakpoint
ALTER TABLE `booking` ADD `google_sync_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `booking` ADD `google_sync_error` text;--> statement-breakpoint
CREATE UNIQUE INDEX `booking_google_event_id_unique` ON `booking` (`google_event_id`);