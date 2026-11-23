CREATE TABLE `login_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `login_links_token_hash_unique` ON `login_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `login_links_email_idx` ON `login_links` (`email`);