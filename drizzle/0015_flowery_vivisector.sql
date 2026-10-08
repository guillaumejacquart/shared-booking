ALTER TABLE `booking` ADD `price_cents_snapshot` integer;--> statement-breakpoint
ALTER TABLE `booking` ADD `price_display_snapshot` text;--> statement-breakpoint
ALTER TABLE `booking` ADD `currency_snapshot` text;--> statement-breakpoint
ALTER TABLE `booking` ADD `cancelled_by` text;--> statement-breakpoint
-- Backfill : recopie le tarif connu au moment de la migration pour les
-- réservations dont la variante existe encore (les autres gardent NULL =
-- tarif inconnu, exclu du CA des stats).
UPDATE `booking` SET `price_cents_snapshot` = (SELECT `price_cents` FROM `session_type_variant` WHERE `session_type_variant`.`id` = `booking`.`session_variant_id`), `price_display_snapshot` = (SELECT `price_display` FROM `session_type_variant` WHERE `session_type_variant`.`id` = `booking`.`session_variant_id`), `currency_snapshot` = (SELECT `currency` FROM `session_type` WHERE `session_type`.`id` = `booking`.`session_type_id`) WHERE `session_variant_id` IS NOT NULL;
