CREATE TABLE `api_token` (
	`id` text PRIMARY KEY NOT NULL,
	`practitioner_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`scopes` text DEFAULT '["read","write"]' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`expires_at` integer,
	`last_used_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`practitioner_id`) REFERENCES `practitioner`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_token_token_hash_unique` ON `api_token` (`token_hash`);--> statement-breakpoint
CREATE INDEX `api_token_practitioner_idx` ON `api_token` (`practitioner_id`);