CREATE TABLE `project_resources` (
	`project_id` text PRIMARY KEY NOT NULL,
	`php_version` text NOT NULL,
	`cpu_limit` integer NOT NULL,
	`memory_limit` integer NOT NULL,
	`disk_quota` integer NOT NULL,
	`internal_port` integer NOT NULL,
	`updated_at` text NOT NULL
);
