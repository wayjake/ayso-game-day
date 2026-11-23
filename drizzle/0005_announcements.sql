CREATE TABLE `announcement_recipients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`announcement_id` integer NOT NULL,
	`team_id` integer NOT NULL,
	`family_email` text NOT NULL,
	`family_label` text NOT NULL,
	`sent_to_email` text NOT NULL,
	`parent_user_id` integer,
	`conversation_id` integer,
	`message_id` integer,
	`ack_token` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`resend_email_id` text,
	`email_message_id` text,
	`sent_at` text,
	`delivered_at` text,
	`opened_at` text,
	`bounced_at` text,
	`bounce_reason` text,
	`complained_at` text,
	`replied_at` text,
	`acknowledged_at` text,
	`reminded_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `announcement_recipients_ack_token_unique` ON `announcement_recipients` (`ack_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `announcement_recipients_family_idx` ON `announcement_recipients` (`announcement_id`,`family_email`);--> statement-breakpoint
CREATE INDEX `announcement_recipients_resend_idx` ON `announcement_recipients` (`resend_email_id`);--> statement-breakpoint
CREATE INDEX `announcement_recipients_message_idx` ON `announcement_recipients` (`email_message_id`);--> statement-breakpoint
CREATE INDEX `announcement_recipients_team_email_idx` ON `announcement_recipients` (`team_id`,`family_email`);--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` integer NOT NULL,
	`sent_by` integer NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`ask` text DEFAULT 'none' NOT NULL,
	`from_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sent_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `announcements_team_idx` ON `announcements` (`team_id`);--> statement-breakpoint
CREATE TABLE `family_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` integer NOT NULL,
	`family_email` text NOT NULL,
	`author_id` integer NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `family_notes_family_idx` ON `family_notes` (`team_id`,`family_email`);--> statement-breakpoint
CREATE TABLE `inbound_emails` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resend_email_id` text NOT NULL,
	`from_email` text NOT NULL,
	`from_name` text,
	`to_emails` text NOT NULL,
	`subject` text,
	`text` text,
	`email_message_id` text,
	`in_reply_to` text,
	`references` text,
	`auth_passed` integer,
	`is_auto_reply` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'unmatched' NOT NULL,
	`matched_by` text,
	`team_id` integer,
	`owner_user_id` integer,
	`conversation_id` integer,
	`recipient_id` integer,
	`received_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_id`) REFERENCES `announcement_recipients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbound_emails_resend_email_id_unique` ON `inbound_emails` (`resend_email_id`);--> statement-breakpoint
CREATE INDEX `inbound_emails_status_idx` ON `inbound_emails` (`status`);--> statement-breakpoint
CREATE INDEX `inbound_emails_owner_idx` ON `inbound_emails` (`owner_user_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer NOT NULL,
	`sender_id` integer,
	`sender_email` text,
	`sender_name` text,
	`source` text DEFAULT 'app' NOT NULL,
	`body` text NOT NULL,
	`announcement_id` integer,
	`inbound_email_id` integer,
	`emailed_to` text,
	`resend_email_id` text,
	`email_message_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_messages`("id", "conversation_id", "sender_id", "body", "created_at") SELECT "id", "conversation_id", "sender_id", "body", "created_at" FROM `messages`;--> statement-breakpoint
DROP TABLE `messages`;--> statement-breakpoint
ALTER TABLE `__new_messages` RENAME TO `messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `messages_conversation_idx` ON `messages` (`conversation_id`,`id`);--> statement-breakpoint
CREATE INDEX `messages_resend_email_idx` ON `messages` (`resend_email_id`);--> statement-breakpoint
CREATE INDEX `messages_email_message_idx` ON `messages` (`email_message_id`);--> statement-breakpoint
ALTER TABLE `conversations` ADD `family_email` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `needs_reply` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_family_email_idx` ON `conversations` (`team_id`,`family_email`) WHERE kind = 'direct' and family_email is not null;--> statement-breakpoint
ALTER TABLE `users` ADD `sending_email` text;--> statement-breakpoint
ALTER TABLE `users` ADD `tours_seen` text;