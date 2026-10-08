PRAGMA foreign_keys=OFF;--> statement-breakpoint
-- Backfill : prix affiché devenu obligatoire ("0" = tarif à définir).
UPDATE `session_type_variant` SET `price_display`='0' WHERE `price_display` IS NULL;--> statement-breakpoint
CREATE TABLE `__new_session_type_variant` (
	`id` text PRIMARY KEY NOT NULL,
	`session_type_id` text NOT NULL,
	`duration_min` integer NOT NULL,
	`buffer_after_min` integer DEFAULT 0 NOT NULL,
	`price_display` text DEFAULT '0' NOT NULL,
	`price_cents` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_type_id`) REFERENCES `session_type`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_session_type_variant`("id", "session_type_id", "duration_min", "buffer_after_min", "price_display", "price_cents", "sort_order", "created_at", "updated_at") SELECT "id", "session_type_id", "duration_min", "buffer_after_min", "price_display", "price_cents", "sort_order", "created_at", "updated_at" FROM `session_type_variant`;--> statement-breakpoint
DROP TABLE `session_type_variant`;--> statement-breakpoint
ALTER TABLE `__new_session_type_variant` RENAME TO `session_type_variant`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `session_type_variant_session_idx` ON `session_type_variant` (`session_type_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_type_variant_duration_idx` ON `session_type_variant` (`session_type_id`,`duration_min`);