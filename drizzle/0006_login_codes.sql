ALTER TABLE `login_links` ADD `code_hash` text;--> statement-breakpoint
ALTER TABLE `login_links` ADD `code_attempts` integer DEFAULT 0 NOT NULL;