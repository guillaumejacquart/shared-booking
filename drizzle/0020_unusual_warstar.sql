PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_office` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`address` text,
	`timezone` text DEFAULT 'Europe/Paris' NOT NULL,
	`enable_practitioner_pages` integer DEFAULT true NOT NULL,
	`enable_office_page` integer DEFAULT false NOT NULL,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`subscription_status` text,
	`subscription_current_period_end` integer,
	`booking_lead_time_min` integer DEFAULT 120 NOT NULL,
	`cancel_deadline_hours` integer DEFAULT 24 NOT NULL,
	`reminder_hours_before` integer DEFAULT 24 NOT NULL,
	`default_buffer_after_min` integer DEFAULT 0 NOT NULL,
	`theme_palette` text DEFAULT 'sauge' NOT NULL,
	`theme_mode` text DEFAULT 'light' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_office`("id", "name", "slug", "address", "timezone", "enable_practitioner_pages", "enable_office_page", "stripe_customer_id", "stripe_subscription_id", "subscription_status", "subscription_current_period_end", "booking_lead_time_min", "cancel_deadline_hours", "reminder_hours_before", "default_buffer_after_min", "theme_palette", "theme_mode", "created_at", "updated_at") SELECT "id", "name", "slug", "address", "timezone", "enable_practitioner_pages", "enable_office_page", "stripe_customer_id", "stripe_subscription_id", "subscription_status", "subscription_current_period_end", "booking_lead_time_min", "cancel_deadline_hours", "reminder_hours_before", "default_buffer_after_min", "theme_palette", "theme_mode", "created_at", "updated_at" FROM `office`;--> statement-breakpoint
DROP TABLE `office`;--> statement-breakpoint
ALTER TABLE `__new_office` RENAME TO `office`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `office_slug_unique` ON `office` (`slug`);--> statement-breakpoint
-- Ancien défaut 'system' (suit l'appareil) → 'light' : sauge clair pour
-- tout le monde. Les cabinets en 'dark' explicite sont inchangés ; chacun
-- peut rechoisir sombre/système dans Paramètres.
UPDATE `office` SET `theme_mode` = 'light' WHERE `theme_mode` = 'system';