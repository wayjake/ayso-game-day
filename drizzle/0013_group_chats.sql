CREATE TABLE `conversation_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer NOT NULL,
	`user_id` integer,
	`family_email` text,
	`added_by` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_members_user_idx` ON `conversation_members` (`conversation_id`,`user_id`) WHERE user_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_members_email_idx` ON `conversation_members` (`conversation_id`,`family_email`) WHERE user_id is null;--> statement-breakpoint
CREATE INDEX `conversation_members_user_lookup_idx` ON `conversation_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `conversation_members_email_lookup_idx` ON `conversation_members` (`family_email`);--> statement-breakpoint
ALTER TABLE `conversations` ADD `name` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `created_by` integer REFERENCES users(id);