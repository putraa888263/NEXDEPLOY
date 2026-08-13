CREATE TABLE `backup_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`backup_id` text NOT NULL,
	`action` text NOT NULL,
	`status` text NOT NULL,
	`requested_by` text NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE TABLE `backup_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`level` text NOT NULL,
	`message` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `backups` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`size` integer,
	`retention_days` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text
);
