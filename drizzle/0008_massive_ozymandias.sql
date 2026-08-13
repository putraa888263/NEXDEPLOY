ALTER TABLE `deployments` ADD `action` text DEFAULT 'Deploy' NOT NULL;--> statement-breakpoint
ALTER TABLE `deployments` ADD `source_deployment_id` text;