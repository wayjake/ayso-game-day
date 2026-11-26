PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_announcement_recipients` (
	`id` text PRIMARY KEY NOT NULL,
	`announcement_id` text NOT NULL,
	`team_id` text NOT NULL,
	`family_email` text NOT NULL,
	`family_label` text NOT NULL,
	`sent_to_email` text NOT NULL,
	`parent_user_id` text,
	`conversation_id` text,
	`message_id` text,
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
	`acknowledged_by` text,
	`acknowledged_via` text,
	`reminded_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`acknowledged_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_announcement_recipients`("id", "announcement_id", "team_id", "family_email", "family_label", "sent_to_email", "parent_user_id", "conversation_id", "message_id", "ack_token", "status", "error", "resend_email_id", "email_message_id", "sent_at", "delivered_at", "opened_at", "bounced_at", "bounce_reason", "complained_at", "replied_at", "acknowledged_at", "acknowledged_by", "acknowledged_via", "reminded_at", "created_at") SELECT "id", "announcement_id", "team_id", "family_email", "family_label", "sent_to_email", "parent_user_id", "conversation_id", "message_id", "ack_token", "status", "error", "resend_email_id", "email_message_id", "sent_at", "delivered_at", "opened_at", "bounced_at", "bounce_reason", "complained_at", "replied_at", "acknowledged_at", "acknowledged_by", "acknowledged_via", "reminded_at", "created_at" FROM `announcement_recipients`;--> statement-breakpoint
DROP TABLE `announcement_recipients`;--> statement-breakpoint
ALTER TABLE `__new_announcement_recipients` RENAME TO `announcement_recipients`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `announcement_recipients_ack_token_unique` ON `announcement_recipients` (`ack_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `announcement_recipients_family_idx` ON `announcement_recipients` (`announcement_id`,`family_email`);--> statement-breakpoint
CREATE INDEX `announcement_recipients_resend_idx` ON `announcement_recipients` (`resend_email_id`);--> statement-breakpoint
CREATE INDEX `announcement_recipients_message_idx` ON `announcement_recipients` (`email_message_id`);--> statement-breakpoint
CREATE INDEX `announcement_recipients_team_email_idx` ON `announcement_recipients` (`team_id`,`family_email`);--> statement-breakpoint
CREATE TABLE `__new_announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`sent_by` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`ask` text DEFAULT 'none' NOT NULL,
	`from_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sent_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_announcements`("id", "team_id", "sent_by", "subject", "body", "ask", "from_email", "created_at") SELECT "id", "team_id", "sent_by", "subject", "body", "ask", "from_email", "created_at" FROM `announcements`;--> statement-breakpoint
DROP TABLE `announcements`;--> statement-breakpoint
ALTER TABLE `__new_announcements` RENAME TO `announcements`;--> statement-breakpoint
CREATE INDEX `announcements_team_idx` ON `announcements` (`team_id`);--> statement-breakpoint
CREATE TABLE `__new_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`player_id` text NOT NULL,
	`position_number` integer NOT NULL,
	`position_name` text,
	`quarter` integer,
	`is_sitting_out` integer DEFAULT false,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_assignments`("id", "game_id", "player_id", "position_number", "position_name", "quarter", "is_sitting_out", "created_at", "updated_at") SELECT "id", "game_id", "player_id", "position_number", "position_name", "quarter", "is_sitting_out", "created_at", "updated_at" FROM `assignments`;--> statement-breakpoint
DROP TABLE `assignments`;--> statement-breakpoint
ALTER TABLE `__new_assignments` RENAME TO `assignments`;--> statement-breakpoint
CREATE TABLE `__new_calendar_feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_calendar_feeds`("id", "user_id", "token", "created_at") SELECT "id", "user_id", "token", "created_at" FROM `calendar_feeds`;--> statement-breakpoint
DROP TABLE `calendar_feeds`;--> statement-breakpoint
ALTER TABLE `__new_calendar_feeds` RENAME TO `calendar_feeds`;--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feeds_user_id_unique` ON `calendar_feeds` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feeds_token_unique` ON `calendar_feeds` (`token`);--> statement-breakpoint
CREATE TABLE `__new_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`player_id` text,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`relationship` text,
	`is_primary` integer DEFAULT false,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_contacts`("id", "team_id", "player_id", "name", "email", "phone", "relationship", "is_primary", "notes", "created_at", "updated_at") SELECT "id", "team_id", "player_id", "name", "email", "phone", "relationship", "is_primary", "notes", "created_at", "updated_at" FROM `contacts`;--> statement-breakpoint
DROP TABLE `contacts`;--> statement-breakpoint
ALTER TABLE `__new_contacts` RENAME TO `contacts`;--> statement-breakpoint
CREATE TABLE `__new_conversation_members` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`user_id` text,
	`family_email` text,
	`added_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_conversation_members`("id", "conversation_id", "user_id", "family_email", "added_by", "created_at") SELECT "id", "conversation_id", "user_id", "family_email", "added_by", "created_at" FROM `conversation_members`;--> statement-breakpoint
DROP TABLE `conversation_members`;--> statement-breakpoint
ALTER TABLE `__new_conversation_members` RENAME TO `conversation_members`;--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_members_user_idx` ON `conversation_members` (`conversation_id`,`user_id`) WHERE user_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_members_email_idx` ON `conversation_members` (`conversation_id`,`family_email`) WHERE user_id is null;--> statement-breakpoint
CREATE INDEX `conversation_members_user_lookup_idx` ON `conversation_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `conversation_members_email_lookup_idx` ON `conversation_members` (`family_email`);--> statement-breakpoint
CREATE TABLE `__new_conversation_read_marks` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`up_to_message_id` text NOT NULL,
	`read_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_conversation_read_marks`("id", "conversation_id", "user_id", "up_to_message_id", "read_at") SELECT "id", "conversation_id", "user_id", "up_to_message_id", "read_at" FROM `conversation_read_marks`;--> statement-breakpoint
DROP TABLE `conversation_read_marks`;--> statement-breakpoint
ALTER TABLE `__new_conversation_read_marks` RENAME TO `conversation_read_marks`;--> statement-breakpoint
CREATE INDEX `conversation_read_marks_idx` ON `conversation_read_marks` (`conversation_id`,`user_id`,`up_to_message_id`);--> statement-breakpoint
CREATE TABLE `__new_conversation_reads` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`last_read_message_id` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_conversation_reads`("id", "conversation_id", "user_id", "last_read_message_id", "updated_at") SELECT "id", "conversation_id", "user_id", "last_read_message_id", "updated_at" FROM `conversation_reads`;--> statement-breakpoint
DROP TABLE `conversation_reads`;--> statement-breakpoint
ALTER TABLE `__new_conversation_reads` RENAME TO `conversation_reads`;--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_reads_idx` ON `conversation_reads` (`conversation_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `__new_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text,
	`created_by` text,
	`staff_user_id` text,
	`parent_user_id` text,
	`family_email` text,
	`needs_reply` integer DEFAULT false NOT NULL,
	`last_message_at` text,
	`last_message_preview` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`staff_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_conversations`("id", "team_id", "kind", "name", "created_by", "staff_user_id", "parent_user_id", "family_email", "needs_reply", "last_message_at", "last_message_preview", "created_at") SELECT "id", "team_id", "kind", "name", "created_by", "staff_user_id", "parent_user_id", "family_email", "needs_reply", "last_message_at", "last_message_preview", "created_at" FROM `conversations`;--> statement-breakpoint
DROP TABLE `conversations`;--> statement-breakpoint
ALTER TABLE `__new_conversations` RENAME TO `conversations`;--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_team_chat_idx` ON `conversations` (`team_id`) WHERE kind = 'team';--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_direct_staff_idx` ON `conversations` (`team_id`,`staff_user_id`,`parent_user_id`) WHERE kind = 'direct';--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_family_email_staff_idx` ON `conversations` (`team_id`,`staff_user_id`,`family_email`) WHERE kind = 'direct' and family_email is not null;--> statement-breakpoint
CREATE TABLE `__new_email_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`game_id` text,
	`sent_by` text NOT NULL,
	`provider` text NOT NULL,
	`provider_message_id` text,
	`subject` text NOT NULL,
	`recipients` text NOT NULL,
	`body` text,
	`status` text DEFAULT 'sending',
	`error_message` text,
	`sent_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`delivered_at` text,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sent_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_email_logs`("id", "team_id", "game_id", "sent_by", "provider", "provider_message_id", "subject", "recipients", "body", "status", "error_message", "sent_at", "delivered_at") SELECT "id", "team_id", "game_id", "sent_by", "provider", "provider_message_id", "subject", "recipients", "body", "status", "error_message", "sent_at", "delivered_at" FROM `email_logs`;--> statement-breakpoint
DROP TABLE `email_logs`;--> statement-breakpoint
ALTER TABLE `__new_email_logs` RENAME TO `email_logs`;--> statement-breakpoint
CREATE TABLE `__new_family_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`family_email` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_family_notes`("id", "team_id", "family_email", "author_id", "body", "created_at") SELECT "id", "team_id", "family_email", "author_id", "body", "created_at" FROM `family_notes`;--> statement-breakpoint
DROP TABLE `family_notes`;--> statement-breakpoint
ALTER TABLE `__new_family_notes` RENAME TO `family_notes`;--> statement-breakpoint
CREATE INDEX `family_notes_family_idx` ON `family_notes` (`team_id`,`family_email`);--> statement-breakpoint
CREATE TABLE `__new_games` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`formation_id` integer,
	`opponent` text,
	`game_date` text NOT NULL,
	`game_time` text,
	`field` text,
	`home_away` text,
	`status` text DEFAULT 'scheduled',
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`formation_id`) REFERENCES `template_formations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_games`("id", "team_id", "formation_id", "opponent", "game_date", "game_time", "field", "home_away", "status", "notes", "created_at", "updated_at") SELECT "id", "team_id", "formation_id", "opponent", "game_date", "game_time", "field", "home_away", "status", "notes", "created_at", "updated_at" FROM `games`;--> statement-breakpoint
DROP TABLE `games`;--> statement-breakpoint
ALTER TABLE `__new_games` RENAME TO `games`;--> statement-breakpoint
CREATE TABLE `__new_guardians` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`player_id` text NOT NULL,
	`team_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_guardians`("id", "user_id", "player_id", "team_id", "created_at") SELECT "id", "user_id", "player_id", "team_id", "created_at" FROM `guardians`;--> statement-breakpoint
DROP TABLE `guardians`;--> statement-breakpoint
ALTER TABLE `__new_guardians` RENAME TO `guardians`;--> statement-breakpoint
CREATE UNIQUE INDEX `guardians_user_player_idx` ON `guardians` (`user_id`,`player_id`);--> statement-breakpoint
CREATE INDEX `guardians_team_idx` ON `guardians` (`team_id`);--> statement-breakpoint
CREATE TABLE `__new_inbound_emails` (
	`id` text PRIMARY KEY NOT NULL,
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
	`team_id` text,
	`owner_user_id` text,
	`conversation_id` text,
	`recipient_id` text,
	`received_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_id`) REFERENCES `announcement_recipients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_inbound_emails`("id", "resend_email_id", "from_email", "from_name", "to_emails", "subject", "text", "email_message_id", "in_reply_to", "references", "auth_passed", "is_auto_reply", "status", "matched_by", "team_id", "owner_user_id", "conversation_id", "recipient_id", "received_at", "created_at") SELECT "id", "resend_email_id", "from_email", "from_name", "to_emails", "subject", "text", "email_message_id", "in_reply_to", "references", "auth_passed", "is_auto_reply", "status", "matched_by", "team_id", "owner_user_id", "conversation_id", "recipient_id", "received_at", "created_at" FROM `inbound_emails`;--> statement-breakpoint
DROP TABLE `inbound_emails`;--> statement-breakpoint
ALTER TABLE `__new_inbound_emails` RENAME TO `inbound_emails`;--> statement-breakpoint
CREATE UNIQUE INDEX `inbound_emails_resend_email_id_unique` ON `inbound_emails` (`resend_email_id`);--> statement-breakpoint
CREATE INDEX `inbound_emails_status_idx` ON `inbound_emails` (`status`);--> statement-breakpoint
CREATE INDEX `inbound_emails_owner_idx` ON `inbound_emails` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `__new_inbox_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_message_id` text,
	`gmail_message_id` text,
	`direction` text NOT NULL,
	`from_email` text NOT NULL,
	`from_name` text,
	`to_emails` text NOT NULL,
	`subject` text NOT NULL,
	`body` text,
	`body_html` text,
	`attachments` text,
	`received_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `inbox_threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_inbox_messages`("id", "thread_id", "provider", "provider_message_id", "gmail_message_id", "direction", "from_email", "from_name", "to_emails", "subject", "body", "body_html", "attachments", "received_at") SELECT "id", "thread_id", "provider", "provider_message_id", "gmail_message_id", "direction", "from_email", "from_name", "to_emails", "subject", "body", "body_html", "attachments", "received_at" FROM `inbox_messages`;--> statement-breakpoint
DROP TABLE `inbox_messages`;--> statement-breakpoint
ALTER TABLE `__new_inbox_messages` RENAME TO `inbox_messages`;--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_messages_provider_message_id_unique` ON `inbox_messages` (`provider_message_id`);--> statement-breakpoint
CREATE TABLE `__new_inbox_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`game_id` text,
	`subject` text NOT NULL,
	`participants` text NOT NULL,
	`last_message_at` text NOT NULL,
	`last_message_preview` text,
	`is_read` integer DEFAULT false,
	`message_count` integer DEFAULT 1,
	`gmail_thread_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_inbox_threads`("id", "team_id", "game_id", "subject", "participants", "last_message_at", "last_message_preview", "is_read", "message_count", "gmail_thread_id", "created_at") SELECT "id", "team_id", "game_id", "subject", "participants", "last_message_at", "last_message_preview", "is_read", "message_count", "gmail_thread_id", "created_at" FROM `inbox_threads`;--> statement-breakpoint
DROP TABLE `inbox_threads`;--> statement-breakpoint
ALTER TABLE `__new_inbox_threads` RENAME TO `inbox_threads`;--> statement-breakpoint
CREATE TABLE `__new_ledger_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`user_id` text NOT NULL,
	`player_ids` text NOT NULL,
	`cents` integer NOT NULL,
	`method` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`txn_id` text,
	`client_key` text NOT NULL,
	`resolved_by` text,
	`resolved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`txn_id`) REFERENCES `ledger_txns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_ledger_claims`("id", "team_id", "user_id", "player_ids", "cents", "method", "note", "status", "txn_id", "client_key", "resolved_by", "resolved_at", "created_at") SELECT "id", "team_id", "user_id", "player_ids", "cents", "method", "note", "status", "txn_id", "client_key", "resolved_by", "resolved_at", "created_at" FROM `ledger_claims`;--> statement-breakpoint
DROP TABLE `ledger_claims`;--> statement-breakpoint
ALTER TABLE `__new_ledger_claims` RENAME TO `ledger_claims`;--> statement-breakpoint
CREATE INDEX `ledger_claims_team_status_idx` ON `ledger_claims` (`team_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_claims_client_key_idx` ON `ledger_claims` (`team_id`,`client_key`);--> statement-breakpoint
CREATE TABLE `__new_ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`txn_id` text NOT NULL,
	`team_id` text NOT NULL,
	`account_type` text NOT NULL,
	`player_id` text,
	`user_id` text,
	`item_id` text,
	`fund_id` text,
	`cents` integer NOT NULL,
	FOREIGN KEY (`txn_id`) REFERENCES `ledger_txns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `ledger_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fund_id`) REFERENCES `ledger_funds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_ledger_entries`("id", "txn_id", "team_id", "account_type", "player_id", "user_id", "item_id", "fund_id", "cents") SELECT "id", "txn_id", "team_id", "account_type", "player_id", "user_id", "item_id", "fund_id", "cents" FROM `ledger_entries`;--> statement-breakpoint
DROP TABLE `ledger_entries`;--> statement-breakpoint
ALTER TABLE `__new_ledger_entries` RENAME TO `ledger_entries`;--> statement-breakpoint
CREATE INDEX `ledger_entries_txn_idx` ON `ledger_entries` (`txn_id`);--> statement-breakpoint
CREATE INDEX `ledger_entries_team_account_idx` ON `ledger_entries` (`team_id`,`account_type`);--> statement-breakpoint
CREATE INDEX `ledger_entries_player_idx` ON `ledger_entries` (`player_id`);--> statement-breakpoint
CREATE TABLE `__new_ledger_funds` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`visible_to_families` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_ledger_funds`("id", "team_id", "name", "visible_to_families", "created_at") SELECT "id", "team_id", "name", "visible_to_families", "created_at" FROM `ledger_funds`;--> statement-breakpoint
DROP TABLE `ledger_funds`;--> statement-breakpoint
ALTER TABLE `__new_ledger_funds` RENAME TO `ledger_funds`;--> statement-breakpoint
CREATE INDEX `ledger_funds_team_idx` ON `ledger_funds` (`team_id`);--> statement-breakpoint
CREATE TABLE `__new_ledger_invoice_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`player_id` text,
	`user_id` text,
	`item_id` text,
	`label` text NOT NULL,
	`cents` integer NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `ledger_invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `ledger_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `ledger_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_ledger_invoice_lines`("id", "invoice_id", "entry_id", "player_id", "user_id", "item_id", "label", "cents") SELECT "id", "invoice_id", "entry_id", "player_id", "user_id", "item_id", "label", "cents" FROM `ledger_invoice_lines`;--> statement-breakpoint
DROP TABLE `ledger_invoice_lines`;--> statement-breakpoint
ALTER TABLE `__new_ledger_invoice_lines` RENAME TO `ledger_invoice_lines`;--> statement-breakpoint
CREATE INDEX `ledger_invoice_lines_invoice_idx` ON `ledger_invoice_lines` (`invoice_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_invoice_lines_entry_idx` ON `ledger_invoice_lines` (`entry_id`);--> statement-breakpoint
CREATE INDEX `ledger_invoice_lines_player_idx` ON `ledger_invoice_lines` (`player_id`);--> statement-breakpoint
CREATE TABLE `__new_ledger_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`number` integer NOT NULL,
	`family_key` text NOT NULL,
	`family_name` text NOT NULL,
	`total_cents` integer NOT NULL,
	`issued_by` text NOT NULL,
	`issued_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`client_key` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issued_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_ledger_invoices`("id", "team_id", "number", "family_key", "family_name", "total_cents", "issued_by", "issued_at", "client_key") SELECT "id", "team_id", "number", "family_key", "family_name", "total_cents", "issued_by", "issued_at", "client_key" FROM `ledger_invoices`;--> statement-breakpoint
DROP TABLE `ledger_invoices`;--> statement-breakpoint
ALTER TABLE `__new_ledger_invoices` RENAME TO `ledger_invoices`;--> statement-breakpoint
CREATE INDEX `ledger_invoices_team_idx` ON `ledger_invoices` (`team_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_invoices_number_idx` ON `ledger_invoices` (`team_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_invoices_client_key_idx` ON `ledger_invoices` (`team_id`,`client_key`);--> statement-breakpoint
CREATE TABLE `__new_ledger_item_events` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`item_id` text NOT NULL,
	`event_type` text NOT NULL,
	`event_id` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `ledger_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_ledger_item_events`("id", "team_id", "item_id", "event_type", "event_id") SELECT "id", "team_id", "item_id", "event_type", "event_id" FROM `ledger_item_events`;--> statement-breakpoint
DROP TABLE `ledger_item_events`;--> statement-breakpoint
ALTER TABLE `__new_ledger_item_events` RENAME TO `ledger_item_events`;--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_item_events_idx` ON `ledger_item_events` (`item_id`,`event_type`,`event_id`);--> statement-breakpoint
CREATE INDEX `ledger_item_events_event_idx` ON `ledger_item_events` (`team_id`,`event_type`,`event_id`);--> statement-breakpoint
CREATE TABLE `__new_ledger_items` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`details` text,
	`refundable` integer DEFAULT false NOT NULL,
	`due_date` text,
	`share_mode` text,
	`total_cents` integer,
	`rounding` text DEFAULT 'cent' NOT NULL,
	`unit_cents` integer,
	`settled_at` text,
	`settled_by` text,
	`created_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`settled_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_ledger_items`("id", "team_id", "name", "category", "details", "refundable", "due_date", "share_mode", "total_cents", "rounding", "unit_cents", "settled_at", "settled_by", "created_by", "created_at", "updated_at") SELECT "id", "team_id", "name", "category", "details", "refundable", "due_date", "share_mode", "total_cents", "rounding", "unit_cents", "settled_at", "settled_by", "created_by", "created_at", "updated_at" FROM `ledger_items`;--> statement-breakpoint
DROP TABLE `ledger_items`;--> statement-breakpoint
ALTER TABLE `__new_ledger_items` RENAME TO `ledger_items`;--> statement-breakpoint
CREATE INDEX `ledger_items_team_idx` ON `ledger_items` (`team_id`);--> statement-breakpoint
CREATE TABLE `__new_ledger_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`item_id` text NOT NULL,
	`player_id` text,
	`user_id` text,
	`weight` integer DEFAULT 2 NOT NULL,
	`fixed_cents` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `ledger_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_ledger_shares`("id", "team_id", "item_id", "player_id", "user_id", "weight", "fixed_cents", "created_at") SELECT "id", "team_id", "item_id", "player_id", "user_id", "weight", "fixed_cents", "created_at" FROM `ledger_shares`;--> statement-breakpoint
DROP TABLE `ledger_shares`;--> statement-breakpoint
ALTER TABLE `__new_ledger_shares` RENAME TO `ledger_shares`;--> statement-breakpoint
CREATE INDEX `ledger_shares_item_idx` ON `ledger_shares` (`item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_shares_item_player_idx` ON `ledger_shares` (`item_id`,`player_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_shares_item_user_idx` ON `ledger_shares` (`item_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `__new_ledger_txns` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`kind` text NOT NULL,
	`item_id` text,
	`fund_id` text,
	`memo` text,
	`method` text,
	`payer_user_id` text,
	`payer_name` text,
	`occurred_on` text NOT NULL,
	`reverses_id` text,
	`client_key` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `ledger_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fund_id`) REFERENCES `ledger_funds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_ledger_txns`("id", "team_id", "kind", "item_id", "fund_id", "memo", "method", "payer_user_id", "payer_name", "occurred_on", "reverses_id", "client_key", "created_by", "created_at") SELECT "id", "team_id", "kind", "item_id", "fund_id", "memo", "method", "payer_user_id", "payer_name", "occurred_on", "reverses_id", "client_key", "created_by", "created_at" FROM `ledger_txns`;--> statement-breakpoint
DROP TABLE `ledger_txns`;--> statement-breakpoint
ALTER TABLE `__new_ledger_txns` RENAME TO `ledger_txns`;--> statement-breakpoint
CREATE INDEX `ledger_txns_team_idx` ON `ledger_txns` (`team_id`,`id`);--> statement-breakpoint
CREATE INDEX `ledger_txns_item_idx` ON `ledger_txns` (`item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_txns_reverses_idx` ON `ledger_txns` (`reverses_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_txns_client_key_idx` ON `ledger_txns` (`team_id`,`client_key`);--> statement-breakpoint
CREATE TABLE `__new_login_links` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`code_hash` text,
	`code_attempts` integer DEFAULT 0 NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_login_links`("id", "email", "token_hash", "code_hash", "code_attempts", "expires_at", "used_at", "created_at") SELECT "id", "email", "token_hash", "code_hash", "code_attempts", "expires_at", "used_at", "created_at" FROM `login_links`;--> statement-breakpoint
DROP TABLE `login_links`;--> statement-breakpoint
ALTER TABLE `__new_login_links` RENAME TO `login_links`;--> statement-breakpoint
CREATE UNIQUE INDEX `login_links_token_hash_unique` ON `login_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `login_links_email_idx` ON `login_links` (`email`);--> statement-breakpoint
CREATE TABLE `__new_message_reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`user_id` text NOT NULL,
	`emoji` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_message_reactions`("id", "message_id", "user_id", "emoji", "created_at") SELECT "id", "message_id", "user_id", "emoji", "created_at" FROM `message_reactions`;--> statement-breakpoint
DROP TABLE `message_reactions`;--> statement-breakpoint
ALTER TABLE `__new_message_reactions` RENAME TO `message_reactions`;--> statement-breakpoint
CREATE UNIQUE INDEX `message_reactions_unique_idx` ON `message_reactions` (`message_id`,`user_id`,`emoji`);--> statement-breakpoint
CREATE TABLE `__new_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`sender_id` text,
	`sender_email` text,
	`sender_name` text,
	`source` text DEFAULT 'app' NOT NULL,
	`body` text NOT NULL,
	`announcement_id` text,
	`inbound_email_id` text,
	`emailed_to` text,
	`resend_email_id` text,
	`email_message_id` text,
	`parent_id` text,
	`deleted_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_messages`("id", "conversation_id", "sender_id", "sender_email", "sender_name", "source", "body", "announcement_id", "inbound_email_id", "emailed_to", "resend_email_id", "email_message_id", "parent_id", "deleted_at", "created_at") SELECT "id", "conversation_id", "sender_id", "sender_email", "sender_name", "source", "body", "announcement_id", "inbound_email_id", "emailed_to", "resend_email_id", "email_message_id", "parent_id", "deleted_at", "created_at" FROM `messages`;--> statement-breakpoint
DROP TABLE `messages`;--> statement-breakpoint
ALTER TABLE `__new_messages` RENAME TO `messages`;--> statement-breakpoint
CREATE INDEX `messages_conversation_idx` ON `messages` (`conversation_id`,`id`);--> statement-breakpoint
CREATE INDEX `messages_parent_idx` ON `messages` (`parent_id`,`id`);--> statement-breakpoint
CREATE INDEX `messages_resend_email_idx` ON `messages` (`resend_email_id`);--> statement-breakpoint
CREATE INDEX `messages_email_message_idx` ON `messages` (`email_message_id`);--> statement-breakpoint
CREATE TABLE `__new_oauth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`token_type` text DEFAULT 'Bearer',
	`expires_at` text NOT NULL,
	`scope` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_oauth_tokens`("id", "user_id", "provider", "access_token", "refresh_token", "token_type", "expires_at", "scope", "created_at", "updated_at") SELECT "id", "user_id", "provider", "access_token", "refresh_token", "token_type", "expires_at", "scope", "created_at", "updated_at" FROM `oauth_tokens`;--> statement-breakpoint
DROP TABLE `oauth_tokens`;--> statement-breakpoint
ALTER TABLE `__new_oauth_tokens` RENAME TO `oauth_tokens`;--> statement-breakpoint
CREATE TABLE `__new_parent_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`email` text NOT NULL,
	`share_code` text NOT NULL,
	`invited_by` text NOT NULL,
	`expires_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`accepted_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accepted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_parent_invites`("id", "team_id", "email", "share_code", "invited_by", "expires_at", "status", "accepted_by", "created_at") SELECT "id", "team_id", "email", "share_code", "invited_by", "expires_at", "status", "accepted_by", "created_at" FROM `parent_invites`;--> statement-breakpoint
DROP TABLE `parent_invites`;--> statement-breakpoint
ALTER TABLE `__new_parent_invites` RENAME TO `parent_invites`;--> statement-breakpoint
CREATE UNIQUE INDEX `parent_invites_share_code_unique` ON `parent_invites` (`share_code`);--> statement-breakpoint
CREATE TABLE `__new_password_resets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_password_resets`("id", "user_id", "token_hash", "expires_at", "used_at", "created_at") SELECT "id", "user_id", "token_hash", "expires_at", "used_at", "created_at" FROM `password_resets`;--> statement-breakpoint
DROP TABLE `password_resets`;--> statement-breakpoint
ALTER TABLE `__new_password_resets` RENAME TO `password_resets`;--> statement-breakpoint
CREATE UNIQUE INDEX `password_resets_token_hash_unique` ON `password_resets` (`token_hash`);--> statement-breakpoint
CREATE TABLE `__new_players` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`coach_id` text,
	`name` text NOT NULL,
	`jersey_number` integer,
	`description` text,
	`profile_picture` text,
	`profile_image_base` text,
	`preferred_positions` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`coach_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_players`("id", "team_id", "coach_id", "name", "jersey_number", "description", "profile_picture", "profile_image_base", "preferred_positions", "created_at", "updated_at") SELECT "id", "team_id", "coach_id", "name", "jersey_number", "description", "profile_picture", "profile_image_base", "preferred_positions", "created_at", "updated_at" FROM `players`;--> statement-breakpoint
DROP TABLE `players`;--> statement-breakpoint
ALTER TABLE `__new_players` RENAME TO `players`;--> statement-breakpoint
CREATE TABLE `__new_post_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_post_comments`("id", "post_id", "user_id", "client_id", "body", "created_at") SELECT "id", "post_id", "user_id", "client_id", "body", "created_at" FROM `post_comments`;--> statement-breakpoint
DROP TABLE `post_comments`;--> statement-breakpoint
ALTER TABLE `__new_post_comments` RENAME TO `post_comments`;--> statement-breakpoint
CREATE UNIQUE INDEX `post_comments_client_id_unique` ON `post_comments` (`client_id`);--> statement-breakpoint
CREATE INDEX `post_comments_post_idx` ON `post_comments` (`post_id`,`id`);--> statement-breakpoint
CREATE TABLE `__new_post_likes` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_post_likes`("id", "post_id", "user_id", "created_at") SELECT "id", "post_id", "user_id", "created_at" FROM `post_likes`;--> statement-breakpoint
DROP TABLE `post_likes`;--> statement-breakpoint
ALTER TABLE `__new_post_likes` RENAME TO `post_likes`;--> statement-breakpoint
CREATE UNIQUE INDEX `post_likes_unique_idx` ON `post_likes` (`post_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `__new_post_media` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`type` text NOT NULL,
	`url` text NOT NULL,
	`file_key` text NOT NULL,
	`display_url` text,
	`display_key` text,
	`thumb_url` text,
	`thumb_key` text,
	`width` integer,
	`height` integer,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_post_media`("id", "post_id", "position", "type", "url", "file_key", "display_url", "display_key", "thumb_url", "thumb_key", "width", "height") SELECT "id", "post_id", "position", "type", "url", "file_key", "display_url", "display_key", "thumb_url", "thumb_key", "width", "height" FROM `post_media`;--> statement-breakpoint
DROP TABLE `post_media`;--> statement-breakpoint
ALTER TABLE `__new_post_media` RENAME TO `post_media`;--> statement-breakpoint
CREATE UNIQUE INDEX `post_media_file_key_unique` ON `post_media` (`file_key`);--> statement-breakpoint
CREATE INDEX `post_media_post_idx` ON `post_media` (`post_id`,`position`);--> statement-breakpoint
CREATE TABLE `__new_post_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`file_key` text NOT NULL,
	`user_id` text NOT NULL,
	`team_id` text NOT NULL,
	`type` text NOT NULL,
	`url` text NOT NULL,
	`name` text,
	`size` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_post_uploads`("id", "file_key", "user_id", "team_id", "type", "url", "name", "size", "created_at") SELECT "id", "file_key", "user_id", "team_id", "type", "url", "name", "size", "created_at" FROM `post_uploads`;--> statement-breakpoint
DROP TABLE `post_uploads`;--> statement-breakpoint
ALTER TABLE `__new_post_uploads` RENAME TO `post_uploads`;--> statement-breakpoint
CREATE UNIQUE INDEX `post_uploads_file_key_unique` ON `post_uploads` (`file_key`);--> statement-breakpoint
CREATE INDEX `post_uploads_user_idx` ON `post_uploads` (`user_id`);--> statement-breakpoint
CREATE TABLE `__new_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`author_id` text NOT NULL,
	`caption` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_posts`("id", "team_id", "author_id", "caption", "created_at") SELECT "id", "team_id", "author_id", "caption", "created_at" FROM `posts`;--> statement-breakpoint
DROP TABLE `posts`;--> statement-breakpoint
ALTER TABLE `__new_posts` RENAME TO `posts`;--> statement-breakpoint
CREATE INDEX `posts_team_idx` ON `posts` (`team_id`,`id`);--> statement-breakpoint
CREATE TABLE `__new_practices` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`series_id` text,
	`practice_date` text NOT NULL,
	`start_time` text,
	`end_time` text,
	`location` text,
	`notes` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`created_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_practices`("id", "team_id", "series_id", "practice_date", "start_time", "end_time", "location", "notes", "status", "created_by", "created_at", "updated_at") SELECT "id", "team_id", "series_id", "practice_date", "start_time", "end_time", "location", "notes", "status", "created_by", "created_at", "updated_at" FROM `practices`;--> statement-breakpoint
DROP TABLE `practices`;--> statement-breakpoint
ALTER TABLE `__new_practices` RENAME TO `practices`;--> statement-breakpoint
CREATE INDEX `practices_team_date_idx` ON `practices` (`team_id`,`practice_date`);--> statement-breakpoint
CREATE TABLE `__new_push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_agent` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_push_subscriptions`("id", "user_id", "endpoint", "p256dh", "auth", "user_agent", "created_at") SELECT "id", "user_id", "endpoint", "p256dh", "auth", "user_agent", "created_at" FROM `push_subscriptions`;--> statement-breakpoint
DROP TABLE `push_subscriptions`;--> statement-breakpoint
ALTER TABLE `__new_push_subscriptions` RENAME TO `push_subscriptions`;--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `push_subscriptions_user_idx` ON `push_subscriptions` (`user_id`);--> statement-breakpoint
CREATE TABLE `__new_rsvps` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`player_id` text NOT NULL,
	`event_type` text NOT NULL,
	`event_id` text NOT NULL,
	`status` text NOT NULL,
	`note` text,
	`responded_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`responded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_rsvps`("id", "team_id", "player_id", "event_type", "event_id", "status", "note", "responded_by", "created_at", "updated_at") SELECT "id", "team_id", "player_id", "event_type", "event_id", "status", "note", "responded_by", "created_at", "updated_at" FROM `rsvps`;--> statement-breakpoint
DROP TABLE `rsvps`;--> statement-breakpoint
ALTER TABLE `__new_rsvps` RENAME TO `rsvps`;--> statement-breakpoint
CREATE UNIQUE INDEX `rsvps_event_player_idx` ON `rsvps` (`event_type`,`event_id`,`player_id`);--> statement-breakpoint
CREATE INDEX `rsvps_team_idx` ON `rsvps` (`team_id`);--> statement-breakpoint
CREATE TABLE `__new_share_links` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`team_id` text NOT NULL,
	`share_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_share_links`("id", "game_id", "team_id", "share_id", "expires_at", "created_by", "created_at") SELECT "id", "game_id", "team_id", "share_id", "expires_at", "created_by", "created_at" FROM `share_links`;--> statement-breakpoint
DROP TABLE `share_links`;--> statement-breakpoint
ALTER TABLE `__new_share_links` RENAME TO `share_links`;--> statement-breakpoint
CREATE UNIQUE INDEX `share_links_share_id_unique` ON `share_links` (`share_id`);--> statement-breakpoint
CREATE TABLE `__new_sit_outs` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`player_id` text NOT NULL,
	`quarter` integer NOT NULL,
	`reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_sit_outs`("id", "game_id", "player_id", "quarter", "reason", "created_at") SELECT "id", "game_id", "player_id", "quarter", "reason", "created_at" FROM `sit_outs`;--> statement-breakpoint
DROP TABLE `sit_outs`;--> statement-breakpoint
ALTER TABLE `__new_sit_outs` RENAME TO `sit_outs`;--> statement-breakpoint
CREATE TABLE `__new_task_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`team_id` text NOT NULL,
	`player_id` text NOT NULL,
	`family_done_at` text,
	`family_done_by` text,
	`family_done_via` text,
	`confirmed_at` text,
	`confirmed_by` text,
	`note` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`family_done_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`confirmed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_task_assignments`("id", "task_id", "team_id", "player_id", "family_done_at", "family_done_by", "family_done_via", "confirmed_at", "confirmed_by", "note", "created_at") SELECT "id", "task_id", "team_id", "player_id", "family_done_at", "family_done_by", "family_done_via", "confirmed_at", "confirmed_by", "note", "created_at" FROM `task_assignments`;--> statement-breakpoint
DROP TABLE `task_assignments`;--> statement-breakpoint
ALTER TABLE `__new_task_assignments` RENAME TO `task_assignments`;--> statement-breakpoint
CREATE UNIQUE INDEX `task_assignments_task_player_idx` ON `task_assignments` (`task_id`,`player_id`);--> statement-breakpoint
CREATE INDEX `task_assignments_team_player_idx` ON `task_assignments` (`team_id`,`player_id`);--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`title` text NOT NULL,
	`details` text,
	`link` text,
	`due_date` text,
	`assign_all` integer DEFAULT true NOT NULL,
	`per_family` integer DEFAULT false NOT NULL,
	`coach_confirms` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "team_id", "title", "details", "link", "due_date", "assign_all", "per_family", "coach_confirms", "created_by", "created_at", "updated_at") SELECT "id", "team_id", "title", "details", "link", "due_date", "assign_all", "per_family", "coach_confirms", "created_by", "created_at", "updated_at" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
CREATE INDEX `tasks_team_idx` ON `tasks` (`team_id`);--> statement-breakpoint
CREATE TABLE `__new_team_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`email` text,
	`share_code` text,
	`role` text NOT NULL,
	`invited_by` text NOT NULL,
	`expires_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_team_invites`("id", "team_id", "email", "share_code", "role", "invited_by", "expires_at", "status", "created_at") SELECT "id", "team_id", "email", "share_code", "role", "invited_by", "expires_at", "status", "created_at" FROM `team_invites`;--> statement-breakpoint
DROP TABLE `team_invites`;--> statement-breakpoint
ALTER TABLE `__new_team_invites` RENAME TO `team_invites`;--> statement-breakpoint
CREATE UNIQUE INDEX `team_invites_share_code_unique` ON `team_invites` (`share_code`);--> statement-breakpoint
CREATE TABLE `__new_team_members` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`invited_by` text,
	`invited_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`joined_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_team_members`("id", "team_id", "user_id", "role", "invited_by", "invited_at", "joined_at", "status", "created_at", "updated_at") SELECT "id", "team_id", "user_id", "role", "invited_by", "invited_at", "joined_at", "status", "created_at", "updated_at" FROM `team_members`;--> statement-breakpoint
DROP TABLE `team_members`;--> statement-breakpoint
ALTER TABLE `__new_team_members` RENAME TO `team_members`;--> statement-breakpoint
CREATE TABLE `__new_teams` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`coach_id` text NOT NULL,
	`format` text NOT NULL,
	`age_group` text,
	`season` text,
	`region` text,
	`team_number` text,
	`venmo_handle` text,
	`archived_at` text,
	`archived_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`coach_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`archived_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_teams`("id", "code", "name", "coach_id", "format", "age_group", "season", "region", "team_number", "venmo_handle", "archived_at", "archived_by", "created_at", "updated_at") SELECT "id", "code", "name", "coach_id", "format", "age_group", "season", "region", "team_number", "venmo_handle", "archived_at", "archived_by", "created_at", "updated_at" FROM `teams`;--> statement-breakpoint
DROP TABLE `teams`;--> statement-breakpoint
ALTER TABLE `__new_teams` RENAME TO `teams`;--> statement-breakpoint
CREATE UNIQUE INDEX `teams_code_unique` ON `teams` (`code`);--> statement-breakpoint
CREATE TABLE `__new_thread_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`user_id` text NOT NULL,
	`note` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `inbox_threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_thread_notes`("id", "thread_id", "user_id", "note", "created_at", "updated_at") SELECT "id", "thread_id", "user_id", "note", "created_at", "updated_at" FROM `thread_notes`;--> statement-breakpoint
DROP TABLE `thread_notes`;--> statement-breakpoint
ALTER TABLE `__new_thread_notes` RENAME TO `thread_notes`;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password` text NOT NULL,
	`name` text,
	`role` text DEFAULT 'coach' NOT NULL,
	`team_name` text,
	`game_format` text,
	`region` text,
	`sending_email` text,
	`tours_seen` text,
	`notify_prefs` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "email", "password", "name", "role", "team_name", "game_format", "region", "sending_email", "tours_seen", "notify_prefs", "created_at", "updated_at") SELECT "id", "email", "password", "name", "role", "team_name", "game_format", "region", "sending_email", "tours_seen", "notify_prefs", "created_at", "updated_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);