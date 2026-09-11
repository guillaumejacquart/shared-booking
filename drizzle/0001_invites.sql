CREATE TABLE `invite` (
	`id` text PRIMARY KEY NOT NULL,
	`office_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'practitioner' NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`invited_by_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`office_id`) REFERENCES `office`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_token_unique` ON `invite` (`token`);--> statement-breakpoint
CREATE INDEX `invite_office_idx` ON `invite` (`office_id`);