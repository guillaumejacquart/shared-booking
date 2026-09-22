CREATE TABLE `session_type_room` (
	`id` text PRIMARY KEY NOT NULL,
	`session_type_id` text NOT NULL,
	`room_id` text NOT NULL,
	FOREIGN KEY (`session_type_id`) REFERENCES `session_type`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `room`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_type_room_idx` ON `session_type_room` (`session_type_id`,`room_id`);