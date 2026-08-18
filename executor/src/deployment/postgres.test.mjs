import { test } from "node:test";
import assert from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  projectDatabaseIdentity,
  generateDatabasePassword,
  validateProjectDatabaseMetadata,
  saveProjectDatabaseMetadata,
  loadProjectDatabaseMetadata,
  databaseBackupFileName,
  expiredDatabaseBackupFiles,
  backupProjectDatabase,
} from "./postgres.mjs";

const uuid = "3c4767a7-80fe-4294-b756-6153d0aa3d1f";

const config = {
  postgresHost: "postgres",
  postgresPort: "5432",
};

function validMetadata(overrides = {}) {
  const { database, username } = projectDatabaseIdentity(uuid);

  return {
    version: 1,
    driver: "pgsql",
    host: "postgres",
    port: 5432,
    database,
    username,
    password: "A".repeat(32),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test("project identity deterministic", () => {
  const { database, username } = projectDatabaseIdentity(uuid);

  assert.strictEqual(database, "nxd_3c4767a780fe");
  assert.strictEqual(username, "nxu_3c4767a780fe");
});

test("invalid project UUID rejected", () => {
  assert.throws(
    () => projectDatabaseIdentity("invalid"),
    /UUID|valid/i,
  );
});

test("generated password is strong and random", () => {
  const first = generateDatabasePassword();
  const second = generateDatabasePassword();

  assert.ok(first.length >= 32);
  assert.ok(second.length >= 32);
  assert.notStrictEqual(first, second);
});

test("metadata validation success", () => {
  assert.doesNotThrow(() =>
    validateProjectDatabaseMetadata(
      uuid,
      validMetadata(),
      config,
    ),
  );
});

test("metadata validation rejects wrong host", () => {
  assert.throws(() =>
    validateProjectDatabaseMetadata(
      uuid,
      validMetadata({ host: "wrong" }),
      config,
    ),
  );
});

test("metadata validation rejects wrong port", () => {
  assert.throws(() =>
    validateProjectDatabaseMetadata(
      uuid,
      validMetadata({ port: 9999 }),
      config,
    ),
  );
});

test("metadata validation rejects wrong database identity", () => {
  assert.throws(() =>
    validateProjectDatabaseMetadata(
      uuid,
      validMetadata({ database: "nxd_wrong" }),
      config,
    ),
  );
});

test("metadata validation rejects wrong username identity", () => {
  assert.throws(() =>
    validateProjectDatabaseMetadata(
      uuid,
      validMetadata({ username: "nxu_wrong" }),
      config,
    ),
  );
});

test("metadata validation rejects empty password", () => {
  assert.throws(() =>
    validateProjectDatabaseMetadata(
      uuid,
      validMetadata({ password: "" }),
      config,
    ),
  );
});

test("metadata validation rejects short password", () => {
  assert.throws(() =>
    validateProjectDatabaseMetadata(
      uuid,
      validMetadata({ password: "short" }),
      config,
    ),
  );
});

test("metadata validation rejects invalid createdAt", () => {
  assert.throws(() =>
    validateProjectDatabaseMetadata(
      uuid,
      validMetadata({ createdAt: "not-a-date" }),
      config,
    ),
  );
});

test("metadata save/load roundtrip", async () => {
  const tmp = await mkdtemp(
    path.join(os.tmpdir(), "nexdeploy-postgres-test-"),
  );

  try {
    const metadata = validMetadata();

    await saveProjectDatabaseMetadata(
      tmp,
      uuid,
      metadata,
    );

    const loaded = await loadProjectDatabaseMetadata(
      tmp,
      uuid,
    );

    assert.deepStrictEqual(loaded, metadata);
  } finally {
    await rm(tmp, {
      recursive: true,
      force: true,
    });
  }
});

test("missing metadata returns null", async () => {
  const tmp = await mkdtemp(
    path.join(os.tmpdir(), "nexdeploy-postgres-test-"),
  );

  try {
    const loaded = await loadProjectDatabaseMetadata(
      tmp,
      uuid,
    );

    assert.strictEqual(loaded, null);
  } finally {
    await rm(tmp, {
      recursive: true,
      force: true,
    });
  }
});

test("malformed metadata JSON throws instead of being treated as missing", async () => {
  const tmp = await mkdtemp(
    path.join(os.tmpdir(), "nexdeploy-postgres-test-"),
  );

  try {
    const projectDir = path.join(tmp, uuid);

    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(projectDir, { recursive: true }),
    );

    await writeFile(
      path.join(
        projectDir,
        ".nexdeploy-database.json",
      ),
      "{broken-json",
      "utf8",
    );

    await assert.rejects(
      loadProjectDatabaseMetadata(
        tmp,
        uuid,
      ),
    );
  } finally {
    await rm(tmp, {
      recursive: true,
      force: true,
    });
  }
});
test("backup filename is deterministic", () => {
  assert.strictEqual(
    databaseBackupFileName(
      new Date("2026-08-19T11:05:00.000Z"),
    ),
    "20260819T110500Z-pre-migrate.dump",
  );
});

test("backup retention keeps latest ten dumps", () => {
  const files = [];

  for (let i = 1; i <= 12; i += 1) {
    files.push(
      `20260819T${String(i).padStart(2, "0")}0000Z-pre-migrate.dump`,
    );
  }

  files.push("README.txt");

  const expired =
    expiredDatabaseBackupFiles(
      files,
      10,
    );

  assert.deepStrictEqual(
    expired,
    [
      "20260819T020000Z-pre-migrate.dump",
      "20260819T010000Z-pre-migrate.dump",
    ],
  );
});

test("backup uses project credentials through environment and not command arguments", async () => {
  const tmp = await mkdtemp(
    path.join(
      os.tmpdir(),
      "nexdeploy-backup-test-",
    ),
  );

  try {
    const metadata =
      validMetadata();

    let invocation;

    const fakeRunner =
      async (options) => {
        invocation = options;

        await writeFile(
          options.env.NEXDEPLOY_BACKUP_PATH,
          Buffer.from("fake-postgres-custom-dump"),
        );

        return "";
      };

    const result =
      await backupProjectDatabase(
        uuid,
        metadata,
        {
          projectsDir: tmp,
          projectsVolume:
            "nexdeploy_executor-projects",
          postgresHost: "postgres",
          postgresPort: "5432",
          internalNetwork:
            "nexdeploy_nexdeploy-internal",
        },
        {
          now: new Date(
            "2026-08-19T11:05:00.000Z",
          ),
          runner: fakeRunner,
        },
      );

    assert.strictEqual(
      result.fileName,
      "20260819T110500Z-pre-migrate.dump",
    );

    assert.strictEqual(
      invocation.network,
      "nexdeploy_nexdeploy-internal",
    );

    assert.strictEqual(
      invocation.env.PGDATABASE,
      metadata.database,
    );

    assert.strictEqual(
      invocation.env.PGUSER,
      metadata.username,
    );

    assert.strictEqual(
      invocation.env.PGPASSWORD,
      metadata.password,
    );

    assert.ok(
      !invocation.command
        .join(" ")
        .includes(metadata.password),
    );

    assert.deepStrictEqual(
      invocation.volumes,
      [
        `nexdeploy_executor-projects:${tmp}`,
      ],
    );
  } finally {
    await rm(
      tmp,
      {
        recursive: true,
        force: true,
      },
    );
  }
});

test("backup retention rejects invalid value", () => {
  assert.throws(() =>
    expiredDatabaseBackupFiles(
      [],
      0,
    ),
  );
});