import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  mariadbProjectDatabaseIdentity,
  generateMariaDbPassword,
  validateMariaDbMetadata,
  saveMariaDbMetadata,
  loadMariaDbMetadata,
  mariadbBackupFileName,
} from "./mariadb.mjs";

const uuid =
  "3c4767a7-80fe-4294-b756-6153d0aa3d1f";

const config = {
  mariadbHost:
    "mariadb",
  mariadbPort:
    "3306",
};

function validMetadata(
  overrides = {},
) {
  const {
    database,
    username,
  } =
    mariadbProjectDatabaseIdentity(
      uuid,
    );

  return {
    version: 1,
    driver: "mysql",
    engine: "mariadb",
    host: "mariadb",
    port: 3306,
    database,
    username,
    password:
      "A".repeat(32),
    createdAt:
      new Date()
        .toISOString(),
    ...overrides,
  };
}

test(
  "MariaDB project identity deterministic",
  () => {
    const identity =
      mariadbProjectDatabaseIdentity(
        uuid,
      );

    assert.equal(
      identity.database,
      "nxd_3c4767a780fe",
    );

    assert.equal(
      identity.username,
      "nxu_3c4767a780fe",
    );
  },
);

test(
  "MariaDB invalid project UUID rejected",
  () => {
    assert.throws(
      () =>
        mariadbProjectDatabaseIdentity(
          "invalid",
        ),
      /UUID|valid/i,
    );
  },
);

test(
  "MariaDB generated password strong and random",
  () => {
    const first =
      generateMariaDbPassword();

    const second =
      generateMariaDbPassword();

    assert.ok(
      first.length >= 32,
    );

    assert.ok(
      second.length >= 32,
    );

    assert.notEqual(
      first,
      second,
    );
  },
);

test(
  "MariaDB metadata validation succeeds",
  () => {
    assert.doesNotThrow(
      () =>
        validateMariaDbMetadata(
          uuid,
          validMetadata(),
          config,
        ),
    );
  },
);

test(
  "MariaDB metadata rejects wrong driver",
  () => {
    assert.throws(
      () =>
        validateMariaDbMetadata(
          uuid,
          validMetadata({
            driver:
              "pgsql",
          }),
          config,
        ),
      /metadata/i,
    );
  },
);

test(
  "MariaDB metadata save load roundtrip",
  async () => {
    const tmp =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "nexdeploy-mariadb-test-",
        ),
      );

    try {
      const metadata =
        validMetadata();

      await saveMariaDbMetadata(
        tmp,
        uuid,
        metadata,
      );

      const loaded =
        await loadMariaDbMetadata(
          tmp,
          uuid,
        );

      assert.deepEqual(
        loaded,
        metadata,
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
  },
);

test(
  "MariaDB missing metadata returns null",
  async () => {
    const tmp =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "nexdeploy-mariadb-test-",
        ),
      );

    try {
      const loaded =
        await loadMariaDbMetadata(
          tmp,
          uuid,
        );

      assert.equal(
        loaded,
        null,
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
  },
);


test(
  "MariaDB backup filename deterministic",
  () => {
    const date =
      new Date(
        "2026-08-22T05:30:45.000Z",
      );

    assert.equal(
      mariadbBackupFileName(
        date,
      ),
      "20260822T053045Z-pre-migrate.sql",
    );
  },
);

test(
  "MariaDB backup filename rejects invalid date",
  () => {
    assert.throws(
      () =>
        mariadbBackupFileName(
          new Date("invalid"),
        ),
      /tanggal|valid/i,
    );
  },
);
