CREATE TABLE `session_type_variant` (
	`id` text PRIMARY KEY NOT NULL,
	`session_type_id` text NOT NULL,
	`duration_min` integer NOT NULL,
	`buffer_after_min` integer DEFAULT 0 NOT NULL,
	`price_display` text,
	`price_cents` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_type_id`) REFERENCES `session_type`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_type_variant_session_idx` ON `session_type_variant` (`session_type_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_type_variant_duration_idx` ON `session_type_variant` (`session_type_id`,`duration_min`);--> statement-breakpoint
-- Backfill : une variante par séance existante (données copiées avant DROP).
INSERT INTO `session_type_variant` (`id`, `session_type_id`, `duration_min`, `buffer_after_min`, `price_display`, `price_cents`, `sort_order`)
	SELECT lower(hex(randomblob(16))), `id`, `duration_min`, `buffer_after_min`, `price_display`, `price_cents`, 0 FROM `session_type`;
--> statement-breakpoint
ALTER TABLE `booking` ADD `session_variant_id` text REFERENCES session_type_variant(id) ON DELETE SET NULL;--> statement-breakpoint
-- Rattache l'historique : la variante correspond au snapshot de durée.
UPDATE `booking` SET `session_variant_id` = (SELECT `v`.`id` FROM `session_type_variant` `v` WHERE `v`.`session_type_id` = `booking`.`session_type_id` AND `v`.`duration_min` = `booking`.`duration_min_snapshot`) WHERE `session_type_id` IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `session_type` DROP COLUMN `duration_min`;--> statement-breakpoint
ALTER TABLE `session_type` DROP COLUMN `buffer_after_min`;--> statement-breakpoint
ALTER TABLE `session_type` DROP COLUMN `price_display`;--> statement-breakpoint
ALTER TABLE `session_type` DROP COLUMN `price_cents`;
