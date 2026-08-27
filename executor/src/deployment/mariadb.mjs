import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

import {
  runOneShot,
} from "./docker.mjs";

export function mariadbProjectDatabaseIdentity(
  projectId,
) {
  if (
    !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      projectId,
    )
  ) {
    throw new Error(
      "ID project tidak valid: format UUID wajib.",
    );
  }

  const suffix =
    projectId
      .replace(/-/g, "")
      .slice(0, 12);

  return {
    database:
      `nxd_${suffix}`,
    username:
      `nxu_${suffix}`,
  };
}

export function generateMariaDbPassword() {
  return randomBytes(32)
    .toString("base64url");
}

function metadataPath(
  projectsDir,
  projectId,
) {
  return path.join(
    projectsDir,
    projectId,
    ".nexdeploy-mariadb.json",
  );
}

export function validateMariaDbMetadata(
  projectId,
  metadata,
  config,
) {
  const {
    database,
    username,
  } =
    mariadbProjectDatabaseIdentity(
      projectId,
    );

  if (
    !metadata ||
    metadata.version !== 1 ||
    metadata.driver !== "mysql" ||
    metadata.engine !== "mariadb" ||
    metadata.host !==
      config.mariadbHost ||
    metadata.port !==
      Number(config.mariadbPort) ||
    metadata.database !==
      database ||
    metadata.username !==
      username ||
    typeof metadata.password !==
      "string" ||
    metadata.password.length < 32 ||
    !metadata.createdAt ||
    Number.isNaN(
      Date.parse(
        metadata.createdAt,
      ),
    )
  ) {
    throw new Error(
      "Metadata database MariaDB tidak valid atau corrupt.",
    );
  }
}

export async function saveMariaDbMetadata(
  projectsDir,
  projectId,
  data,
) {
  const target =
    metadataPath(
      projectsDir,
      projectId,
    );

  const temporary =
    `${target}.tmp`;

  await fs.mkdir(
    path.dirname(target),
    {
      recursive: true,
    },
  );

  await fs.writeFile(
    temporary,
    JSON.stringify(
      data,
      null,
      2,
    ),
    {
      mode: 0o600,
    },
  );

  await fs.rename(
    temporary,
    target,
  );
}

export async function loadMariaDbMetadata(
  projectsDir,
  projectId,
) {
  try {
    const content =
      await fs.readFile(
        metadataPath(
          projectsDir,
          projectId,
        ),
        "utf8",
      );

    return JSON.parse(
      content,
    );
  } catch (error) {
    if (
      error?.code ===
      "ENOENT"
    ) {
      return null;
    }

    throw new Error(
      "Gagal membaca metadata database MariaDB.",
    );
  }
}

function escapeSqlString(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "''");
}

export async function ensureMariaDbProjectDatabase(
  projectId,
  config,
) {
  const {
    projectsDir,
    projectsVolume,
    mariadbHost,
    mariadbPort,
    rootPassword,
    internalNetwork,
  } = config;

  if (
    !mariadbHost ||
    !mariadbPort ||
    !rootPassword
  ) {
    throw new Error(
      "MariaDB admin configuration missing.",
    );
  }

  const {
    database,
    username,
  } =
    mariadbProjectDatabaseIdentity(
      projectId,
    );

  let metadata =
    await loadMariaDbMetadata(
      projectsDir,
      projectId,
    );

  let password;

  if (metadata) {
    validateMariaDbMetadata(
      projectId,
      metadata,
      config,
    );

    password =
      metadata.password;
  } else {
    password =
      generateMariaDbPassword();

    metadata = {
      version: 1,
      driver: "mysql",
      engine: "mariadb",
      host:
        mariadbHost,
      port:
        Number(
          mariadbPort,
        ),
      database,
      username,
      password,
      createdAt:
        new Date()
          .toISOString(),
    };

    await saveMariaDbMetadata(
      projectsDir,
      projectId,
      metadata,
    );
  }

  const sql = `
CREATE DATABASE IF NOT EXISTS \`${database}\`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS '${username}'@'%'
  IDENTIFIED BY '${escapeSqlString(password)}';

ALTER USER '${username}'@'%'
  IDENTIFIED BY '${escapeSqlString(password)}';

GRANT ALL PRIVILEGES
  ON \`${database}\`.*
  TO '${username}'@'%';

FLUSH PRIVILEGES;
`;

  const sqlPath =
    path.join(
      projectsDir,
      projectId,
      ".nexdeploy-mariadb.sql",
    );

  try {
    await fs.writeFile(
      sqlPath,
      sql,
      {
        mode: 0o600,
      },
    );

    await runOneShot({
      image:
        "mariadb:11.4",
      network:
        internalNetwork,
      env: {
        MYSQL_PWD:
          rootPassword,
      },
      volumes: [
        `${projectsVolume}:${projectsDir}`,
      ],
      command: [
        "mariadb",
        "-h",
        mariadbHost,
        "-P",
        String(
          mariadbPort,
        ),
        "-uroot",
        "-e",
        `source ${sqlPath}`,
      ],
    });
  } finally {
    await fs.rm(
      sqlPath,
      {
        force: true,
      },
    );
  }

  return metadata;
}

export function mariadbBackupFileName(
  date = new Date(),
) {
  if (
    !(date instanceof Date) ||
    Number.isNaN(date.getTime())
  ) {
    throw new Error(
      "Tanggal backup MariaDB tidak valid.",
    );
  }

  const timestamp =
    date
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");

  return `${timestamp}-pre-migrate.sql`;
}

export async function backupMariaDbProjectDatabase(
  projectId,
  metadata,
  config,
  {
    retention = 10,
  } = {},
) {
  validateMariaDbMetadata(
    projectId,
    metadata,
    config,
  );

  if (
    !Number.isInteger(retention) ||
    retention < 1
  ) {
    throw new Error(
      "Retention backup MariaDB tidak valid.",
    );
  }

  const backupDir =
    path.join(
      config.projectsDir,
      projectId,
      "backups",
      "database",
    );

  await fs.mkdir(
    backupDir,
    {
      recursive: true,
    },
  );

  const fileName =
    mariadbBackupFileName();

  const outputPath =
    path.join(
      backupDir,
      fileName,
    );

  const shellCommand = [
    "set -eu",
    "umask 077",
    [
      "mariadb-dump",
      `-h "${metadata.host}"`,
      `-P "${metadata.port}"`,
      `-u "${metadata.username}"`,
      "--single-transaction",
      "--quick",
      "--routines",
      "--triggers",
      "--events",
      `"${metadata.database}"`,
      `> "${outputPath}"`,
    ].join(" "),
    `test -s "${outputPath}"`,
  ].join("; ");

  await runOneShot({
    image:
      "mariadb:11.4",
    network:
      config.internalNetwork,
    env: {
      MYSQL_PWD:
        metadata.password,
    },
    volumes: [
      `${config.projectsVolume}:${config.projectsDir}`,
    ],
    command: [
      "sh",
      "-lc",
      shellCommand,
    ],
  });

  let backupStat;

  try {
    backupStat =
      await fs.stat(
        outputPath,
      );
  } catch {
    throw new Error(
      "File backup database MariaDB tidak ditemukan setelah mariadb-dump.",
    );
  }

  if (
    !backupStat.isFile() ||
    backupStat.size < 1
  ) {
    throw new Error(
      "File backup database MariaDB kosong atau tidak valid.",
    );
  }

  const entries =
    await fs.readdir(
      backupDir,
    );

  const expired =
    entries
      .filter((name) =>
        /^\d{8}T\d{6}Z-pre-migrate\.sql$/.test(
          name,
        ),
      )
      .sort()
      .reverse()
      .slice(retention);

  for (
    const expiredFile
    of expired
  ) {
    await fs.rm(
      path.join(
        backupDir,
        expiredFile,
      ),
      {
        force: true,
      },
    );
  }

  return {
    fileName,
    path:
      outputPath,
    size:
      backupStat.size,
    prunedFiles:
      expired,
  };
}


export function validateMariaDbBackupFileName(
  fileName,
) {
  if (
    typeof fileName !== "string" ||
    !/^\d{8}T\d{6}Z-(?:pre-migrate|pre-restore)\.sql$/.test(
      fileName,
    )
  ) {
    throw new Error(
      "Nama file backup MariaDB tidak valid.",
    );
  }

  return fileName;
}

export function mariaDbRestoreSafetyBackupFileName(
  date = new Date(),
) {
  if (
    !(date instanceof Date) ||
    Number.isNaN(date.getTime())
  ) {
    throw new Error(
      "Tanggal safety backup MariaDB tidak valid.",
    );
  }

  const timestamp =
    date
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");

  return `${timestamp}-pre-restore.sql`;
}

export async function restoreMariaDbProjectDatabase(
  projectId,
  metadata,
  backupFileName,
  config,
  options = {},
) {
  validateMariaDbMetadata(
    projectId,
    metadata,
    config,
  );

  validateMariaDbBackupFileName(
    backupFileName,
  );

  const {
    projectsDir,
    projectsVolume,
    mariadbHost,
    mariadbPort,
    rootPassword,
    internalNetwork,
  } = config;

  if (
    typeof projectsVolume !== "string" ||
    !projectsVolume
  ) {
    throw new Error(
      "Projects volume untuk restore MariaDB tidak tersedia.",
    );
  }

  if (
    !mariadbHost ||
    !mariadbPort ||
    !rootPassword
  ) {
    throw new Error(
      "MariaDB admin configuration untuk restore tidak tersedia.",
    );
  }

  const runner =
    options.runner ??
    runOneShot;

  const now =
    options.now ??
    new Date();

  const backupDir =
    path.join(
      projectsDir,
      projectId,
      "backups",
      "database",
    );

  const sourcePath =
    path.join(
      backupDir,
      backupFileName,
    );

  let sourceStat;

  try {
    sourceStat =
      await fs.stat(
        sourcePath,
      );
  } catch {
    throw new Error(
      "File backup MariaDB untuk restore tidak ditemukan.",
    );
  }

  if (
    !sourceStat.isFile() ||
    sourceStat.size < 1
  ) {
    throw new Error(
      "File backup MariaDB untuk restore kosong atau tidak valid.",
    );
  }

  /*
   * Validasi ringan source sebelum database disentuh.
   * mariadb client harus bisa membaca seluruh SQL tanpa
   * mengeksekusinya; minimal file harus non-empty dan
   * tidak boleh mengandung NUL byte.
   */
  const sourceBuffer =
    await fs.readFile(
      sourcePath,
    );

  if (
    sourceBuffer.includes(0)
  ) {
    throw new Error(
      "File backup MariaDB mengandung data biner yang tidak valid.",
    );
  }

  const safetyFileName =
    mariaDbRestoreSafetyBackupFileName(
      now,
    );

  const safetyPath =
    path.join(
      backupDir,
      safetyFileName,
    );

  /*
   * Safety backup kondisi database SAAT INI.
   */
  try {
    await runner({
      image:
        "mariadb:11.4",

      network:
        internalNetwork,

      env: {
        MYSQL_PWD:
          metadata.password,
        NEXDEPLOY_BACKUP_PATH:
          safetyPath,
      },

      volumes: [
        `${projectsVolume}:${projectsDir}`,
      ],

      command: [
        "sh",
        "-lc",
        [
          "set -eu",
          "umask 077",
          [
            "mariadb-dump",
            `-h "${metadata.host}"`,
            `-P "${metadata.port}"`,
            `-u "${metadata.username}"`,
            "--single-transaction",
            "--quick",
            "--routines",
            "--triggers",
            "--events",
            `"${metadata.database}"`,
            '> "$NEXDEPLOY_BACKUP_PATH"',
          ].join(" "),
          'test -s "$NEXDEPLOY_BACKUP_PATH"',
        ].join("; "),
      ],
    });
  } catch {
    throw new Error(
      "Safety backup MariaDB sebelum restore gagal.",
    );
  }

  let safetyStat;

  try {
    safetyStat =
      await fs.stat(
        safetyPath,
      );
  } catch {
    throw new Error(
      "Safety backup MariaDB sebelum restore tidak ditemukan.",
    );
  }

  if (
    !safetyStat.isFile() ||
    safetyStat.size < 1
  ) {
    throw new Error(
      "Safety backup MariaDB sebelum restore kosong.",
    );
  }

  /*
   * Recreate database menggunakan root.
   * User project tetap dipertahankan.
   */
  const recreateSql = [
    `DROP DATABASE IF EXISTS \`${metadata.database}\`;`,
    `CREATE DATABASE \`${metadata.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
    `GRANT ALL PRIVILEGES ON \`${metadata.database}\`.* TO '${metadata.username}'@'%';`,
    "FLUSH PRIVILEGES;",
  ].join(" ");

  try {
    await runner({
      image:
        "mariadb:11.4",

      network:
        internalNetwork,

      env: {
        MYSQL_PWD:
          rootPassword,
      },

      command: [
        "mariadb",
        "-h",
        mariadbHost,
        "-P",
        String(
          mariadbPort,
        ),
        "-uroot",
        "-e",
        recreateSql,
      ],
    });

    /*
     * Restore sebagai user project supaya privilege
     * sesuai runtime aplikasi.
     */
    await runner({
      image:
        "mariadb:11.4",

      network:
        internalNetwork,

      env: {
        MYSQL_PWD:
          metadata.password,
        NEXDEPLOY_RESTORE_SOURCE:
          sourcePath,
      },

      volumes: [
        `${projectsVolume}:${projectsDir}`,
      ],

      command: [
        "sh",
        "-lc",
        [
          "set -eu",
          [
            "mariadb",
            `-h "${metadata.host}"`,
            `-P "${metadata.port}"`,
            `-u "${metadata.username}"`,
            `"${metadata.database}"`,
            '< "$NEXDEPLOY_RESTORE_SOURCE"',
          ].join(" "),
        ].join("; "),
      ],
    });

    /*
     * Post-restore connection verification.
     */
    await runner({
      image:
        "mariadb:11.4",

      network:
        internalNetwork,

      env: {
        MYSQL_PWD:
          metadata.password,
      },

      command: [
        "mariadb",
        "-h",
        metadata.host,
        "-P",
        String(
          metadata.port,
        ),
        "-u",
        metadata.username,
        metadata.database,
        "-Nse",
        "SELECT 1;",
      ],
    });
  } catch {
    throw new Error(
      "Restore database MariaDB gagal setelah safety backup dibuat.",
    );
  }

  return {
    restoredFrom:
      backupFileName,

    safetyBackup:
      safetyFileName,

    safetyBackupSize:
      safetyStat.size,

    database:
      metadata.database,

    username:
      metadata.username,
  };
}

export async function dropMariaDbProjectDatabase(
  projectId,
  config,
) {
  const {
    database,
    username,
  } =
    mariadbProjectDatabaseIdentity(
      projectId,
    );

  const {
    mariadbHost,
    mariadbPort,
    rootPassword,
    internalNetwork,
  } = config;

  if (!rootPassword) {
    throw new Error(
      "MariaDB admin configuration missing.",
    );
  }

  const sql = [
    `DROP DATABASE IF EXISTS \`${database}\`;`,
    `DROP USER IF EXISTS '${username}'@'%';`,
    "FLUSH PRIVILEGES;",
  ].join(" ");

  await runOneShot({
    image:
      "mariadb:11.4",
    network:
      internalNetwork,
    env: {
      MYSQL_PWD:
        rootPassword,
    },
    command: [
      "mariadb",
      "-h",
      mariadbHost,
      "-P",
      String(
        mariadbPort,
      ),
      "-uroot",
      "-e",
      sql,
    ],
  });

  return {
    database,
    username,
  };
}
