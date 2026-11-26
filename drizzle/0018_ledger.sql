CREATE TABLE `ledger_claims` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`player_ids` text NOT NULL,
	`cents` integer NOT NULL,
	`method` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`txn_id` integer,
	`client_key` text NOT NULL,
	`resolved_by` integer,
	`resolved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`txn_id`) REFERENCES `ledger_txns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ledger_claims_team_status_idx` ON `ledger_claims` (`team_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_claims_client_key_idx` ON `ledger_claims` (`team_id`,`client_key`);--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`txn_id` integer NOT NULL,
	`team_id` integer NOT NULL,
	`account_type` text NOT NULL,
	`player_id` integer,
	`user_id` integer,
	`item_id` integer,
	`fund_id` integer,
	`cents` integer NOT NULL,
	FOREIGN KEY (`txn_id`) REFERENCES `ledger_txns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `ledger_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fund_id`) REFERENCES `ledger_funds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ledger_entries_txn_idx` ON `ledger_entries` (`txn_id`);--> statement-breakpoint
CREATE INDEX `ledger_entries_team_account_idx` ON `ledger_entries` (`team_id`,`account_type`);--> statement-breakpoint
CREATE INDEX `ledger_entries_player_idx` ON `ledger_entries` (`player_id`);--> statement-breakpoint
CREATE TABLE `ledger_funds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` integer NOT NULL,
	`name` text NOT NULL,
	`visible_to_families` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ledger_funds_team_idx` ON `ledger_funds` (`team_id`);--> statement-breakpoint
CREATE TABLE `ledger_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` integer NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`details` text,
	`refundable` integer DEFAULT false NOT NULL,
	`due_date` text,
	`created_by` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ledger_items_team_idx` ON `ledger_items` (`team_id`);--> statement-breakpoint
CREATE TABLE `ledger_txns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` integer NOT NULL,
	`kind` text NOT NULL,
	`item_id` integer,
	`fund_id` integer,
	`memo` text,
	`method` text,
	`payer_user_id` integer,
	`payer_name` text,
	`occurred_on` text NOT NULL,
	`reverses_id` integer,
	`client_key` text NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `ledger_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fund_id`) REFERENCES `ledger_funds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ledger_txns_team_idx` ON `ledger_txns` (`team_id`,`id`);--> statement-breakpoint
CREATE INDEX `ledger_txns_item_idx` ON `ledger_txns` (`item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_txns_reverses_idx` ON `ledger_txns` (`reverses_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_txns_client_key_idx` ON `ledger_txns` (`team_id`,`client_key`);--> statement-breakpoint
ALTER TABLE `teams` ADD `venmo_handle` text;