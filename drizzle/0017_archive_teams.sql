ALTER TABLE `teams` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `archived_by` integer REFERENCES users(id);