CREATE TABLE `message_reactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`emoji` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_reactions_unique_idx` ON `message_reactions` (`message_id`,`user_id`,`emoji`);--> statement-breakpoint
ALTER TABLE `messages` ADD `parent_id` integer;--> statement-breakpoint
CREATE INDEX `messages_parent_idx` ON `messages` (`parent_id`,`id`);