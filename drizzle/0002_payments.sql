ALTER TABLE `booking` ADD `payment_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `booking` ADD `stripe_session_id` text;--> statement-breakpoint
ALTER TABLE `booking` ADD `stripe_payment_intent_id` text;--> statement-breakpoint
ALTER TABLE `booking` ADD `validation_required` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `booking` ADD `validated_at` integer;--> statement-breakpoint
ALTER TABLE `booking` ADD `pending_expires_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `booking_stripe_session_id_unique` ON `booking` (`stripe_session_id`);--> statement-breakpoint
ALTER TABLE `session_type` ADD `requires_payment` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `session_type` ADD `price_cents` integer;--> statement-breakpoint
ALTER TABLE `session_type` ADD `currency` text DEFAULT 'eur' NOT NULL;--> statement-breakpoint
ALTER TABLE `session_type` ADD `requires_validation` integer DEFAULT false NOT NULL;