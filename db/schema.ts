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
