CREATE TABLE `ledger_invoice_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`entry_id` integer NOT NULL,
	`player_id` integer,
	`user_id` integer,
	`item_id` integer,
	`label` text NOT NULL,
	`cents` integer NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `ledger_invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `ledger_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `ledger_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ledger_invoice_lines_invoice_idx` ON `ledger_invoice_lines` (`invoice_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_invoice_lines_entry_idx` ON `ledger_invoice_lines` (`entry_id`);--> statement-breakpoint
CREATE INDEX `ledger_invoice_lines_player_idx` ON `ledger_invoice_lines` (`player_id`);--> statement-breakpoint
CREATE TABLE `ledger_invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` integer NOT NULL,
	`number` integer NOT NULL,
	`family_key` text NOT NULL,
	`family_name` text NOT NULL,
	`total_cents` integer NOT NULL,
	`issued_by` integer NOT NULL,
	`issued_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`client_key` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issued_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ledger_invoices_team_idx` ON `ledger_invoices` (`team_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_invoices_number_idx` ON `ledger_invoices` (`team_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_invoices_client_key_idx` ON `ledger_invoices` (`team_id`,`client_key`);--> statement-breakpoint
CREATE TABLE `ledger_item_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`event_type` text NOT NULL,
	`event_id` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `ledger_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_item_events_idx` ON `ledger_item_events` (`item_id`,`event_type`,`event_id`);--> statement-breakpoint
CREATE INDEX `ledger_item_events_event_idx` ON `ledger_item_events` (`team_id`,`event_type`,`event_id`);--> statement-breakpoint
CREATE TABLE `ledger_shares` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`player_id` integer,
	`user_id` integer,
	`weight` integer DEFAULT 2 NOT NULL,
	`fixed_cents` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `ledger_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ledger_shares_item_idx` ON `ledger_shares` (`item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_shares_item_player_idx` ON `ledger_shares` (`item_id`,`player_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_shares_item_user_idx` ON `ledger_shares` (`item_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `ledger_items` ADD `share_mode` text;--> statement-breakpoint
ALTER TABLE `ledger_items` ADD `total_cents` integer;--> statement-breakpoint
ALTER TABLE `ledger_items` ADD `rounding` text DEFAULT 'cent' NOT NULL;--> statement-breakpoint
ALTER TABLE `ledger_items` ADD `unit_cents` integer;--> statement-breakpoint
ALTER TABLE `ledger_items` ADD `settled_at` text;--> statement-breakpoint
ALTER TABLE `ledger_items` ADD `settled_by` integer REFERENCES users(id);