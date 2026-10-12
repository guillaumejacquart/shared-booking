ALTER TABLE `room` ADD `allow_all` integer DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE `room` SET `allow_all` = 0 WHERE `id` IN (SELECT DISTINCT `room_id` FROM `room_member`);
