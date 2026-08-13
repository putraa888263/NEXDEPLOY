CREATE TABLE `project_environment` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`key` text NOT NULL,
	`value_encrypted` text NOT NULL,
	`is_secret` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_environment_project_key_unique` ON `project_environment` (`project_id`,`key`);