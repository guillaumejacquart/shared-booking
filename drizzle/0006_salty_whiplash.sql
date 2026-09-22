PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_availability_rule` (
	`id` text PRIMARY KEY NOT NULL,
	`practitioner_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	FOREIGN KEY (`practitioner_id`) REFERENCES `practitioner`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_availability_rule`("id", "practitioner_id", "weekday", "start_time", "end_time") SELECT "id", "practitioner_id", "weekday", "start_time", "end_time" FROM `availability_rule`;--> statement-breakpoint
DROP TABLE `availability_rule`;--> statement-breakpoint
ALTER TABLE `__new_availability_rule` RENAME TO `availability_rule`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `availability_practitioner_idx` ON `availability_rule` (`practitioner_id`);