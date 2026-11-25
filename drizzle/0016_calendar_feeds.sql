CREATE TABLE `calendar_feeds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feeds_user_id_unique` ON `calendar_feeds` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feeds_token_unique` ON `calendar_feeds` (`token`);