CREATE TABLE `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`palette` text DEFAULT 'sauge' NOT NULL,
	`mode` text DEFAULT 'system' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `office` ADD `theme_palette` text DEFAULT 'sauge' NOT NULL;