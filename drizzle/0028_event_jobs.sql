CREATE TABLE `event_job_signups` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`team_id` text NOT NULL,
	`player_id` text,
	`user_id` text,
	`signed_up_by` text,
	`via` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `event_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`signed_up_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_job_signups_job_player_idx` ON `event_job_signups` (`job_id`,`player_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `event_job_signups_job_user_idx` ON `event_job_signups` (`job_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `event_job_signups_team_player_idx` ON `event_job_signups` (`team_id`,`player_id`);--> statement-breakpoint
CREATE TABLE `event_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`event_type` text NOT NULL,
	`event_id` text NOT NULL,
	`title` text NOT NULL,
	`details` text,
	`timing` text,
	`mode` text DEFAULT 'volunteer' NOT NULL,
	`spots` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_jobs_event_idx` ON `event_jobs` (`team_id`,`event_type`,`event_id`);