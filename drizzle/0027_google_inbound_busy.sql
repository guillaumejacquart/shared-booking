ALTER TABLE `practitioner_google` ADD `block_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `practitioner_google` ADD `block_calendar_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `practitioner_google` ADD `block_all_day` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `practitioner_google` ADD `last_busy_at` integer;