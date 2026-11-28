CREATE TABLE `ledger_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`txn_id` text NOT NULL,
	`sent_to` text NOT NULL,
	`sent_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`txn_id`) REFERENCES `ledger_txns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sent_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ledger_receipts_txn_idx` ON `ledger_receipts` (`team_id`,`txn_id`);--> statement-breakpoint
ALTER TABLE `teams` ADD `receipt_email_subject` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `receipt_email_body` text;