ALTER TABLE `conversations` ADD `audience` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `topic` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `staff_only_posts` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `conversations` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `archived_by` text REFERENCES users(id);--> statement-breakpoint
CREATE INDEX `conversations_channel_idx` ON `conversations` (`team_id`) WHERE kind = 'channel';