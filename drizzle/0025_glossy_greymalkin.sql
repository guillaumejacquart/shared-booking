DROP INDEX `practitioner_user_id_unique`;--> statement-breakpoint
DROP INDEX `practitioner_office_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `practitioner_office_user_idx` ON `practitioner` (`office_id`,`user_id`);