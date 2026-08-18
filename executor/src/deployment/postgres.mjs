import { promises as fs } from "node:fs";
import path from "node:path";
import { runOneShot } from "./docker.mjs";
import { randomBytes } from "node:crypto";

export function projectDatabaseIdentity(projectId) {
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(projectId)) {
    throw new Error("ID project tidak valid: format UUID wajib.");
  }
  const suffix = projectId.replace(/-/g, "").slice(0, 12);
  return {
    database: `nxd_${suffix}`,
    username: `nxu_${suffix}`,
  };
}

export function generateDatabasePassword() {
  return randomBytes(32).toString("base64url");
}

export function validateProjectDatabaseMetadata(projectId, metadata, config) {
  const { database, username } = projectDatabaseIdentity(projectId);
  const { postgresHost, postgresPort } = config;

  if (!metadata || metadata.version !== 1 || metadata.driver !== 'pgsql' ||
      metadata.host !== postgresHost || metadata.port !== Number(postgresPort) ||
      metadata.database !== database || metadata.username !== username ||
      typeof metadata.password !== 'string' || metadata.password.length < 32 ||
      !metadata.createdAt || isNaN(Date.parse(metadata.createdAt))) {
    throw new Error("Metadata database tidak valid atau corrupt.");
  }
}

export async function saveProjectDatabaseMetadata(projectsDir, projectId, data) {
  const metaPath = path.join(projectsDir, projectId, ".nexdeploy-database.json");
  const tempPath = `${metaPath}.tmp`;
  const content = JSON.stringify(data, null, 2);

  await fs.mkdir(path.dirname(metaPath), { recursive: true });
  await fs.writeFile(tempPath, content, { mode: 0o600 });
  await fs.rename(tempPath, metaPath);
}

export async function loadProjectDatabaseMetadata(projectsDir, projectId) {
  try {
    const metaPath = path.join(projectsDir, projectId, ".nexdeploy-database.json");
    const content = await fs.readFile(metaPath, "utf8");
    return JSON.parse(content);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error("Gagal membaca metadata database.");
  }
}

export async function ensureProjectDatabase(projectId, config) {
  const { projectsDir, projectsVolume, adminDb, adminUser, adminPass, postgresHost, postgresPort, internalNetwork } = config;
  const { database, username } = projectDatabaseIdentity(projectId);

  let metadata = await loadProjectDatabaseMetadata(projectsDir, projectId);
  let password;

  if (metadata) {
    validateProjectDatabaseMetadata(projectId, metadata, config);
    password = metadata.password;
  } else {
    password = generateDatabasePassword();
    metadata = {
        version: 1, driver: "pgsql", host: postgresHost, port: Number(postgresPort),
        database, username, password, createdAt: new Date().toISOString()
    };
    await saveProjectDatabaseMetadata(projectsDir, projectId, metadata);
  }

  const sqlRole = `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${username}') THEN
        CREATE ROLE "${username}" WITH LOGIN PASSWORD '${password.replace(/'/g, "''")}';
      END IF;
    END
    $$;
  `;

  const roleSqlPath = path.join(
    projectsDir,
    projectId,
    ".nexdeploy-role.sql",
  );

  try {
    await fs.writeFile(
      roleSqlPath,
      sqlRole,
      {
        mode: 0o600,
      },
    );

    await runOneShot({
      image: "postgres:17-alpine",
      network: internalNetwork,
      env: {
        PGHOST: postgresHost,
        PGPORT: postgresPort,
        PGDATABASE: adminDb,
        PGUSER: adminUser,
        PGPASSWORD: adminPass,
      },
      volumes: [
        `${projectsVolume}:${projectsDir}`,
      ],
      command: [
        "psql",
        "-f",
        roleSqlPath,
      ],
    });
  } finally {
    await fs.rm(
      roleSqlPath,
      {
        force: true,
      },
    );
  }

  const checkDb = await runOneShot({
    image: "postgres:17-alpine",
    network: internalNetwork,
    env: { PGHOST: postgresHost, PGPORT: postgresPort, PGDATABASE: adminDb, PGUSER: adminUser, PGPASSWORD: adminPass },
    command: ["psql", "-tAc", `SELECT 1 FROM pg_database WHERE datname = '${database}'`],
  });

  if (checkDb.trim() !== "1") {
      await runOneShot({
        image: "postgres:17-alpine",
        network: internalNetwork,
        env: { PGHOST: postgresHost, PGPORT: postgresPort, PGDATABASE: adminDb, PGUSER: adminUser, PGPASSWORD: adminPass },
        command: ["createdb", "--owner", username, database],
      });
  } else {
      await runOneShot({
        image: "postgres:17-alpine",
        network: internalNetwork,
        env: { PGHOST: postgresHost, PGPORT: postgresPort, PGDATABASE: adminDb, PGUSER: adminUser, PGPASSWORD: adminPass },
        command: ["psql", "-c", `ALTER DATABASE "${database}" OWNER TO "${username}"`],
      });
  }

  return metadata;
}
export function databaseBackupFileName(date = new Date()) {
  if (
    !(date instanceof Date) ||
    Number.isNaN(date.getTime())
  ) {
    throw new Error("Tanggal backup database tidak valid.");
  }

  const timestamp = date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

  return `${timestamp}-pre-migrate.dump`;
}

export function expiredDatabaseBackupFiles(
  fileNames,
  retention = 10,
) {
  if (
    !Number.isInteger(retention) ||
    retention < 1
  ) {
    throw new Error("Retention backup database tidak valid.");
  }

  return fileNames
    .filter((name) =>
      /^\d{8}T\d{6}Z-pre-migrate\.dump$/.test(name),
    )
    .sort()
    .reverse()
    .slice(retention);
}

export async function backupProjectDatabase(
  projectId,
  metadata,
  config,
  options = {},
) {
  const {
    projectsDir,
    projectsVolume,
    postgresHost,
    postgresPort,
    internalNetwork,
  } = config;

  validateProjectDatabaseMetadata(
    projectId,
    metadata,
    config,
  );

  if (
    typeof projectsVolume !== "string" ||
    !projectsVolume
  ) {
    throw new Error(
      "Projects volume untuk backup database tidak tersedia.",
    );
  }

  if (
    typeof internalNetwork !== "string" ||
    !internalNetwork
  ) {
    throw new Error(
      "Internal network untuk backup database tidak tersedia.",
    );
  }

  const retention =
    options.retention ?? 10;

  const now =
    options.now ?? new Date();

  const runner =
    options.runner ?? runOneShot;

  const backupsDir =
    path.join(
      projectsDir,
      projectId,
      "backups",
    );

  const fileName =
    databaseBackupFileName(now);

  const backupPath =
    path.join(
      backupsDir,
      fileName,
    );

  await fs.mkdir(
    backupsDir,
    {
      recursive: true,
    },
  );

  try {
    await runner({
      image: "postgres:17-alpine",
      network: internalNetwork,

      env: {
        PGHOST: postgresHost,
        PGPORT: postgresPort,
        PGDATABASE: metadata.database,
        PGUSER: metadata.username,
        PGPASSWORD: metadata.password,
        NEXDEPLOY_BACKUP_PATH: backupPath,
      },

      volumes: [
        `${projectsVolume}:${projectsDir}`,
      ],

      command: [
        "sh",
        "-c",
        'set -eu; umask 077; mkdir -p "$(dirname "$NEXDEPLOY_BACKUP_PATH")"; pg_dump --format=custom --no-owner --no-acl --file="$NEXDEPLOY_BACKUP_PATH"',
      ],
    });
  } catch {
    throw new Error(
      "Backup database PostgreSQL gagal.",
    );
  }

  let backupStat;

  try {
    backupStat =
      await fs.stat(backupPath);
  } catch {
    throw new Error(
      "File backup database tidak ditemukan setelah pg_dump.",
    );
  }

  if (
    !backupStat.isFile() ||
    backupStat.size < 1
  ) {
    throw new Error(
      "File backup database kosong atau tidak valid.",
    );
  }

  const files =
    await fs.readdir(backupsDir);

  const expired =
    expiredDatabaseBackupFiles(
      files,
      retention,
    );

  for (const name of expired) {
    await fs.rm(
      path.join(
        backupsDir,
        name,
      ),
      {
        force: true,
      },
    );
  }

  return {
    fileName,
    path: backupPath,
    size: backupStat.size,
  };
}