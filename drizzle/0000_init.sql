CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `availability_rule` (
	`id` text PRIMARY KEY NOT NULL,
	`practitioner_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`room_id` text NOT NULL,
	FOREIGN KEY (`practitioner_id`) REFERENCES `practitioner`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `room`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `availability_practitioner_idx` ON `availability_rule` (`practitioner_id`);--> statement-breakpoint
CREATE TABLE `booking` (
	`id` text PRIMARY KEY NOT NULL,
	`office_id` text NOT NULL,
	`practitioner_id` text NOT NULL,
	`room_id` text NOT NULL,
	`session_type_id` text NOT NULL,
	`session_name_snapshot` text NOT NULL,
	`duration_min_snapshot` integer NOT NULL,
	`buffer_after_min_snapshot` integer DEFAULT 0 NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`patient_first_name` text NOT NULL,
	`patient_last_name` text NOT NULL,
	`patient_email` text NOT NULL,
	`patient_phone` text,
	`notes` text,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`cancel_token` text NOT NULL,
	`reschedule_token` text NOT NULL,
	`reminder_sent_at` integer,
	`cancelled_at` integer,
	`cancel_reason` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`office_id`) REFERENCES `office`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`practitioner_id`) REFERENCES `practitioner`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `room`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`session_type_id`) REFERENCES `session_type`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `booking_cancel_token_unique` ON `booking` (`cancel_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `booking_reschedule_token_unique` ON `booking` (`reschedule_token`);--> statement-breakpoint
CREATE INDEX `booking_practitioner_start_idx` ON `booking` (`practitioner_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `booking_room_start_idx` ON `booking` (`room_id`,`start_at`);--> statement-breakpoint
CREATE TABLE `exception` (
	`id` text PRIMARY KEY NOT NULL,
	`practitioner_id` text NOT NULL,
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`start_time` text,
	`end_time` text,
	`full_day` integer DEFAULT false NOT NULL,
	`room_id` text,
	`reason` text,
	FOREIGN KEY (`practitioner_id`) REFERENCES `practitioner`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `room`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `exception_practitioner_date_idx` ON `exception` (`practitioner_id`,`date`);--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`office_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'practitioner' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`office_id`) REFERENCES `office`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_office_user_idx` ON `member` (`office_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `office` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`address` text,
	`timezone` text DEFAULT 'Europe/Paris' NOT NULL,
	`enable_practitioner_pages` integer DEFAULT true NOT NULL,
	`enable_office_page` integer DEFAULT false NOT NULL,
	`booking_lead_time_min` integer DEFAULT 120 NOT NULL,
	`cancel_deadline_hours` integer DEFAULT 24 NOT NULL,
	`reminder_hours_before` integer DEFAULT 24 NOT NULL,
	`default_buffer_after_min` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `office_slug_unique` ON `office` (`slug`);--> statement-breakpoint
CREATE TABLE `practitioner` (
	`id` text PRIMARY KEY NOT NULL,
	`office_id` text NOT NULL,
	`user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`slug` text NOT NULL,
	`bio` text,
	`public_contact` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`office_id`) REFERENCES `office`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `practitioner_user_id_unique` ON `practitioner` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `practitioner_slug_unique` ON `practitioner` (`slug`);--> statement-breakpoint
CREATE INDEX `practitioner_office_idx` ON `practitioner` (`office_id`);--> statement-breakpoint
CREATE TABLE `room` (
	`id` text PRIMARY KEY NOT NULL,
	`office_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#3b82f6' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`office_id`) REFERENCES `office`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `room_office_idx` ON `room` (`office_id`);--> statement-breakpoint
CREATE TABLE `room_member` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`practitioner_id` text NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `room`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`practitioner_id`) REFERENCES `practitioner`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `room_member_idx` ON `room_member` (`room_id`,`practitioner_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `session_type` (
	`id` text PRIMARY KEY NOT NULL,
	`practitioner_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`duration_min` integer NOT NULL,
	`buffer_after_min` integer DEFAULT 0 NOT NULL,
	`price_display` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`practitioner_id`) REFERENCES `practitioner`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_type_practitioner_idx` ON `session_type` (`practitioner_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
