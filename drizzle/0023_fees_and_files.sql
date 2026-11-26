CREATE TABLE `ledger_item_files` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`item_id` text NOT NULL,
	`file_key` text NOT NULL,
	`url` text NOT NULL,
	`name` text NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`type` text DEFAULT '' NOT NULL,
	`uploaded_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `ledger_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ledger_item_files_item_idx` ON `ledger_item_files` (`item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_item_files_key_idx` ON `ledger_item_files` (`file_key`);--> statement-breakpoint
ALTER TABLE `ledger_txns` ADD `fee_cents` integer;