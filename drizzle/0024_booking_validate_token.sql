ALTER TABLE `booking` ADD `validate_token` text;--> statement-breakpoint
UPDATE `booking` SET `validate_token` = lower(hex(randomblob(32))) WHERE `validate_token` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `booking_validate_token_unique` ON `booking` (`validate_token`);
