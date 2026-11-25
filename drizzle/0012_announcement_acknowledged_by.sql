ALTER TABLE `announcement_recipients` ADD `acknowledged_by` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `announcement_recipients` ADD `acknowledged_via` text;