import { env } from "cloudflare:workers";

const defaultSettings = {
  serverName: "VPS Utama", serverIp: "103.127.96.42", location: "Jakarta",
  projectDirectory: "/opt/nexdeploy/projects", baseDomain: "apps.adecloud.id",
  npmUrl: "http://103.127.96.42:81", sslEmail: "admin@adecloud.id",
  defaultDatabase: "MariaDB", databaseVersion: "11.4", backupRetention: 7,
};

let initialized: Promise<void> | null = null;

export function getD1(): D1Database {
  const database = (env as unknown as { DB?: D1Database }).DB;
  if (!database) throw new Error("Database panel belum tersedia.");
  return database;
}

export function ensureDatabase() {
  if (!initialized) initialized = initialize(getD1());
  return initialized;
}

async function initialize(db: D1Database) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Active', last_login_at TEXT, created_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, server_name TEXT NOT NULL, server_ip TEXT NOT NULL, location TEXT NOT NULL, project_directory TEXT NOT NULL, base_domain TEXT NOT NULL, npm_url TEXT NOT NULL, ssl_email TEXT NOT NULL, default_database TEXT NOT NULL, database_version TEXT NOT NULL, backup_retention INTEGER NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, domain TEXT NOT NULL, framework TEXT NOT NULL, database_type TEXT NOT NULL, version TEXT NOT NULL, status TEXT NOT NULL, cpu INTEGER NOT NULL DEFAULT 0, memory INTEGER NOT NULL DEFAULT 0, color TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, project_id TEXT, type TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS login_attempts (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity(created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_login_attempts_locked_until ON login_attempts(locked_until)"),
  ]);
  const userColumns = await db.prepare("PRAGMA table_info(users)").all<{ name: string }>();
  const existingUserColumns = new Set((userColumns.results ?? []).map((column) => column.name));
  if (!existingUserColumns.has("status")) await db.prepare("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'Active'").run();
  if (!existingUserColumns.has("last_login_at")) await db.prepare("ALTER TABLE users ADD COLUMN last_login_at TEXT").run();
  const now = new Date().toISOString();
  await db.prepare("INSERT OR IGNORE INTO settings (id, server_name, server_ip, location, project_directory, base_domain, npm_url, ssl_email, default_database, database_version, backup_retention, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(defaultSettings.serverName, defaultSettings.serverIp, defaultSettings.location, defaultSettings.projectDirectory, defaultSettings.baseDomain, defaultSettings.npmUrl, defaultSettings.sslEmail, defaultSettings.defaultDatabase, defaultSettings.databaseVersion, defaultSettings.backupRetention, now).run();
}
