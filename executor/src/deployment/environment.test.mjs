import assert from "node:assert/strict";
import test from "node:test";

import {
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";

import os from "node:os";
import path from "node:path";

import {
  PROTECTED_ENV_KEYS,
  validateEnvironmentKey,
  normalizeUserEnvironment,
  saveProjectEnvironment,
  loadProjectEnvironment,
} from "./environment.mjs";

const projectId =
  "3c4767a7-80fe-4294-b756-6153d0aa3d1f";

test(
  "environment accepts normal application keys",
  () => {
    assert.equal(
      validateEnvironmentKey(
        "APP_URL",
      ),
      "APP_URL",
    );

    assert.equal(
      validateEnvironmentKey(
        "MAIL_PASSWORD",
      ),
      "MAIL_PASSWORD",
    );

    assert.equal(
      validateEnvironmentKey(
        "PAYMENT_API_KEY",
      ),
      "PAYMENT_API_KEY",
    );
  },
);

test(
  "environment rejects unsafe key names",
  () => {
    for (
      const key of [
        "hello-world",
        "MAIL PASSWORD",
        "1INVALID",
        "FOO.BAR",
        "../SECRET",
        "",
      ]
    ) {
      assert.throws(
        () =>
          validateEnvironmentKey(
            key,
          ),
      );
    }
  },
);

test(
  "environment rejects protected NEXDEPLOY keys",
  () => {
    for (
      const key of
        PROTECTED_ENV_KEYS
    ) {
      assert.throws(
        () =>
          validateEnvironmentKey(
            key,
          ),
        /dikelola oleh NEXDEPLOY/,
      );
    }
  },
);

test(
  "environment normalization accepts string values",
  () => {
    assert.deepStrictEqual(
      normalizeUserEnvironment({
        APP_URL:
          "https://example.com",
        MAIL_HOST:
          "smtp.example.com",
        FEATURE_FLAG:
          "true",
        EMPTY_VALUE:
          "",
      }),
      {
        APP_URL:
          "https://example.com",
        MAIL_HOST:
          "smtp.example.com",
        FEATURE_FLAG:
          "true",
        EMPTY_VALUE:
          "",
      },
    );
  },
);

test(
  "environment normalization rejects non-string values",
  () => {
    assert.throws(
      () =>
        normalizeUserEnvironment({
          PORT: 1234,
        }),
      /harus berupa string/,
    );

    assert.throws(
      () =>
        normalizeUserEnvironment({
          ENABLED: true,
        }),
      /harus berupa string/,
    );
  },
);

test(
  "environment save and load roundtrip",
  async () => {
    const tmp =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "nexdeploy-env-test-",
        ),
      );

    try {
      await saveProjectEnvironment(
        tmp,
        projectId,
        {
          APP_NAME:
            "My App",
          APP_URL:
            "https://app.example.com",
          MAIL_HOST:
            "smtp.example.com",
        },
      );

      const loaded =
        await loadProjectEnvironment(
          tmp,
          projectId,
        );

      assert.deepStrictEqual(
        loaded,
        {
          APP_NAME:
            "My App",
          APP_URL:
            "https://app.example.com",
          MAIL_HOST:
            "smtp.example.com",
        },
      );

      const meta =
        JSON.parse(
          await readFile(
            path.join(
              tmp,
              projectId,
              ".nexdeploy-environment.json",
            ),
            "utf8",
          ),
        );

      assert.equal(
        meta.version,
        1,
      );

      assert.ok(
        Date.parse(
          meta.updatedAt,
        ),
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
  "missing environment metadata returns empty object",
  async () => {
    const tmp =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "nexdeploy-env-test-",
        ),
      );

    try {
      assert.deepStrictEqual(
        await loadProjectEnvironment(
          tmp,
          projectId,
        ),
        {},
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
