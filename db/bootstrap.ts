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

export function getUploads(): R2Bucket {
  const bucket = (env as unknown as { UPLOADS?: R2Bucket }).UPLOADS;
  if (!bucket) throw new Error("Penyimpanan upload belum tersedia.");
  return bucket;
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
    db.prepare("CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, domain TEXT NOT NULL, framework TEXT NOT NULL, database_type TEXT NOT NULL, version TEXT NOT NULL, status TEXT NOT NULL, cpu INTEGER NOT NULL DEFAULT 0, memory INTEGER NOT NULL DEFAULT 0, color TEXT NOT NULL, archive_key TEXT, archive_name TEXT, archive_size INTEGER, archive_validation TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, project_id TEXT, type TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS login_attempts (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS deployments (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, requested_by TEXT NOT NULL, archive_key TEXT NOT NULL, archive_name TEXT NOT NULL, executor TEXT NOT NULL, status TEXT NOT NULL, action TEXT NOT NULL DEFAULT 'Deploy', source_deployment_id TEXT, executor_job_id TEXT, error TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS deployment_logs (id TEXT PRIMARY KEY, deployment_id TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS project_environment (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, key TEXT NOT NULL, value_encrypted TEXT NOT NULL, is_secret INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, UNIQUE(project_id, key))"),
    db.prepare("CREATE TABLE IF NOT EXISTS project_resources (project_id TEXT PRIMARY KEY, php_version TEXT NOT NULL, cpu_limit INTEGER NOT NULL, memory_limit INTEGER NOT NULL, disk_quota INTEGER NOT NULL, internal_port INTEGER NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS backups (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL, size INTEGER, retention_days INTEGER NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS backup_jobs (id TEXT PRIMARY KEY, backup_id TEXT NOT NULL, action TEXT NOT NULL, status TEXT NOT NULL, requested_by TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, finished_at TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS backup_logs (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS executor_settings (id INTEGER PRIMARY KEY, url TEXT NOT NULL, token_encrypted TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS nexa_service_nonces (nonce TEXT PRIMARY KEY, seen_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS nexa_service_requests (idempotency_key TEXT PRIMARY KEY, operation TEXT NOT NULL, project_id TEXT, result_json TEXT NOT NULL, created_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity(created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_login_attempts_locked_until ON login_attempts(locked_until)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_deployments_project_created ON deployments(project_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_deployment_logs_deployment_created ON deployment_logs(deployment_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_project_environment_project_id ON project_environment(project_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_backups_project_created ON backups(project_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_backup_jobs_backup_created ON backup_jobs(backup_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_backup_logs_job_created ON backup_logs(job_id, created_at)"),
  ]);
  const userColumns = await db.prepare("PRAGMA table_info(users)").all<{ name: string }>();
  const existingUserColumns = new Set((userColumns.results ?? []).map((column) => column.name));
  if (!existingUserColumns.has("status")) await db.prepare("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'Active'").run();
  if (!existingUserColumns.has("last_login_at")) await db.prepare("ALTER TABLE users ADD COLUMN last_login_at TEXT").run();
  const projectColumns = await db.prepare("PRAGMA table_info(projects)").all<{ name: string }>();
  const existingProjectColumns = new Set((projectColumns.results ?? []).map((column) => column.name));
  if (!existingProjectColumns.has("archive_key")) await db.prepare("ALTER TABLE projects ADD COLUMN archive_key TEXT").run();
  if (!existingProjectColumns.has("archive_name")) await db.prepare("ALTER TABLE projects ADD COLUMN archive_name TEXT").run();
  if (!existingProjectColumns.has("archive_size")) await db.prepare("ALTER TABLE projects ADD COLUMN archive_size INTEGER").run();
  if (!existingProjectColumns.has("archive_validation")) await db.prepare("ALTER TABLE projects ADD COLUMN archive_validation TEXT").run();
  const deploymentColumns = await db.prepare("PRAGMA table_info(deployments)").all<{ name: string }>();
  const existingDeploymentColumns = new Set((deploymentColumns.results ?? []).map((column) => column.name));
  if (!existingDeploymentColumns.has("action")) await db.prepare("ALTER TABLE deployments ADD COLUMN action TEXT NOT NULL DEFAULT 'Deploy'").run();
  if (!existingDeploymentColumns.has("source_deployment_id")) await db.prepare("ALTER TABLE deployments ADD COLUMN source_deployment_id TEXT").run();
  if (!existingDeploymentColumns.has("executor_job_id")) await db.prepare("ALTER TABLE deployments ADD COLUMN executor_job_id TEXT").run();
  const now = new Date().toISOString();
  await db.prepare("INSERT OR IGNORE INTO settings (id, server_name, server_ip, location, project_directory, base_domain, npm_url, ssl_email, default_database, database_version, backup_retention, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(defaultSettings.serverName, defaultSettings.serverIp, defaultSettings.location, defaultSettings.projectDirectory, defaultSettings.baseDomain, defaultSettings.npmUrl, defaultSettings.sslEmail, defaultSettings.defaultDatabase, defaultSettings.databaseVersion, defaultSettings.backupRetention, now).run();
}
