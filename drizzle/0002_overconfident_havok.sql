ALTER TABLE `users` ADD `status` text DEFAULT 'Active' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `last_login_at` text;