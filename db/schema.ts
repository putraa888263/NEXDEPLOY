import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["Administrator", "Operator", "Viewer"] }).notNull(),
  status: text("status", { enum: ["Active", "Disabled"] }).notNull().default("Active"),
  lastLoginAt: text("last_login_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("users_email_unique").on(table.email)]);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("sessions_token_hash_unique").on(table.tokenHash)]);

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  serverName: text("server_name").notNull(),
  serverIp: text("server_ip").notNull(),
  location: text("location").notNull(),
  projectDirectory: text("project_directory").notNull(),
  baseDomain: text("base_domain").notNull(),
  npmUrl: text("npm_url").notNull(),
  sslEmail: text("ssl_email").notNull(),
  defaultDatabase: text("default_database").notNull(),
  databaseVersion: text("database_version").notNull(),
  backupRetention: integer("backup_retention").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  domain: text("domain").notNull(),
  framework: text("framework").notNull(),
  databaseType: text("database_type").notNull(),
  version: text("version").notNull(),
  status: text("status").notNull(),
  cpu: integer("cpu").notNull().default(0),
  memory: integer("memory").notNull().default(0),
  color: text("color").notNull(),
  archiveKey: text("archive_key"),
  archiveName: text("archive_name"),
  archiveSize: integer("archive_size"),
  archiveValidation: text("archive_validation"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("projects_slug_unique").on(table.slug)]);

export const activity = sqliteTable("activity", {
  id: text("id").primaryKey(),
  projectId: text("project_id"),
  type: text("type").notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  createdAt: text("created_at").notNull(),
});

export const loginAttempts = sqliteTable("login_attempts", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  lockedUntil: text("locked_until"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("login_attempts_locked_until_idx").on(table.lockedUntil)]);

export const deployments = sqliteTable("deployments", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  status: text("status").notNull(),
  requestedBy: text("requested_by").notNull(),
  archiveKey: text("archive_key").notNull(),
  archiveName: text("archive_name").notNull(),
  executor: text("executor").notNull(),
  action: text("action").notNull().default("Deploy"),
  sourceDeploymentId: text("source_deployment_id"),
  executorJobId: text("executor_job_id"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
});

export const deploymentLogs = sqliteTable("deployment_logs", {
  id: text("id").primaryKey(),
  deploymentId: text("deployment_id").notNull(),
  level: text("level").notNull(),
  message: text("message").notNull(),
  createdAt: text("created_at").notNull(),
});

export const projectEnvironment = sqliteTable("project_environment", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  key: text("key").notNull(),
  valueEncrypted: text("value_encrypted").notNull(),
  isSecret: integer("is_secret").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("project_environment_project_key_unique").on(table.projectId, table.key)]);

export const projectResources = sqliteTable("project_resources", {
  projectId: text("project_id").primaryKey(),
  phpVersion: text("php_version").notNull(),
  cpuLimit: integer("cpu_limit").notNull(),
  memoryLimit: integer("memory_limit").notNull(),
  diskQuota: integer("disk_quota").notNull(),
  internalPort: integer("internal_port").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const backups = sqliteTable("backups", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull(),
  size: integer("size"),
  retentionDays: integer("retention_days").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
});

export const backupJobs = sqliteTable("backup_jobs", {
  id: text("id").primaryKey(),
  backupId: text("backup_id").notNull(),
  action: text("action").notNull(),
  status: text("status").notNull(),
  requestedBy: text("requested_by").notNull(),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  finishedAt: text("finished_at"),
});

export const backupLogs = sqliteTable("backup_logs", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  level: text("level").notNull(),
  message: text("message").notNull(),
  createdAt: text("created_at").notNull(),
});
