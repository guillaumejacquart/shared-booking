ALTER TABLE `office` ADD `stripe_customer_id` text;--> statement-breakpoint
ALTER TABLE `office` ADD `stripe_subscription_id` text;--> statement-breakpoint
ALTER TABLE `office` ADD `subscription_status` text;--> statement-breakpoint
ALTER TABLE `office` ADD `subscription_current_period_end` integer;--> statement-breakpoint
ALTER TABLE `practitioner` ADD `stripe_account_id` text;--> statement-breakpoint
ALTER TABLE `practitioner` ADD `stripe_charges_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `practitioner` ADD `stripe_payouts_enabled` integer DEFAULT false NOT NULL;