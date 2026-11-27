CREATE TABLE `ledger_venmo_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`inbound_email_id` text,
	`venmo_txn_id` text NOT NULL,
	`payer_name` text NOT NULL,
	`cents` integer NOT NULL,
	`note` text,
	`sent_to` text,
	`paid_on` text,
	`family_key` text,
	`matched_by` text,
	`verified` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`txn_id` text,
	`resolved_by` text,
	`resolved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inbound_email_id`) REFERENCES `inbound_emails`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`txn_id`) REFERENCES `ledger_txns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ledger_venmo_payments_team_status_idx` ON `ledger_venmo_payments` (`team_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_venmo_payments_txn_idx` ON `ledger_venmo_payments` (`team_id`,`venmo_txn_id`);--> statement-breakpoint
ALTER TABLE `teams` ADD `venmo_email_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `teams_venmo_email_token_unique` ON `teams` (`venmo_email_token`);