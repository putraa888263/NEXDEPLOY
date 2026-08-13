CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`domain` text NOT NULL,
	`framework` text NOT NULL,
	`database_type` text NOT NULL,
	`version` text NOT NULL,
	`status` text NOT NULL,
	`cpu` integer DEFAULT 0 NOT NULL,
	`memory` integer DEFAULT 0 NOT NULL,
	`color` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`server_name` text NOT NULL,
	`server_ip` text NOT NULL,
	`location` text NOT NULL,
	`project_directory` text NOT NULL,
	`base_domain` text NOT NULL,
	`npm_url` text NOT NULL,
	`ssl_email` text NOT NULL,
	`default_database` text NOT NULL,
	`database_version` text NOT NULL,
	`backup_retention` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);