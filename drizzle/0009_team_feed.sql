CREATE TABLE `post_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`post_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`client_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `post_comments_client_id_unique` ON `post_comments` (`client_id`);--> statement-breakpoint
CREATE INDEX `post_comments_post_idx` ON `post_comments` (`post_id`,`id`);--> statement-breakpoint
CREATE TABLE `post_likes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`post_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `post_likes_unique_idx` ON `post_likes` (`post_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `post_media` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`post_id` integer NOT NULL,
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
CREATE UNIQUE INDEX `post_media_file_key_unique` ON `post_media` (`file_key`);--> statement-breakpoint
CREATE INDEX `post_media_post_idx` ON `post_media` (`post_id`,`position`);--> statement-breakpoint
CREATE TABLE `post_uploads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_key` text NOT NULL,
	`user_id` integer NOT NULL,
	`team_id` integer NOT NULL,
	`type` text NOT NULL,
	`url` text NOT NULL,
	`name` text,
	`size` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `post_uploads_file_key_unique` ON `post_uploads` (`file_key`);--> statement-breakpoint
CREATE INDEX `post_uploads_user_idx` ON `post_uploads` (`user_id`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` integer NOT NULL,
	`author_id` integer NOT NULL,
	`caption` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `posts_team_idx` ON `posts` (`team_id`,`id`);