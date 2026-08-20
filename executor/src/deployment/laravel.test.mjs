import assert from "node:assert/strict";

import {
  access,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import test from "node:test";

import {
  buildEntrypointCommand,
  buildQueueWorkerCommand,
  buildSchedulerCommand,
  buildRuntimeEnvironment,
  composerInstallCommand,
  CONTAINER_PORT,
  frontendBuildCommand,
  isLaravelRelease,
  mergeEnvFile,
  resolveLaravelReleaseRoot,
  shouldRunComposer,
  shouldRunFrontendBuild,
  summarizeFailure,
  packageDiscoverCommand,
  clearLaravelBootstrapCache,
} from "./laravel.mjs";

test(
  "isLaravelRelease: true only when both artisan and composer.json exist",
  async () => {
    const root =
      await mkdtemp(
        join(
          tmpdir(),
          "nexdeploy-laravel-",
        ),
      );

    try {
      assert.equal(
        await isLaravelRelease(
          root,
        ),
        false,
      );

      await writeFile(
        join(
          root,
          "artisan",
        ),
        "#!/usr/bin/env php\n",
      );

      assert.equal(
        await isLaravelRelease(
          root,
        ),
        false,
      );

      await writeFile(
        join(
          root,
          "composer.json",
        ),
        "{}",
      );

      assert.equal(
        await isLaravelRelease(
          root,
        ),
        true,
      );
    } finally {
      await rm(
        root,
        {
          recursive: true,
          force: true,
        },
      );
    }
  },
);

test(
  "resolveLaravelReleaseRoot: returns flat Laravel root directly",
  async () => {
    const root =
      await mkdtemp(
        join(
          tmpdir(),
          "nexdeploy-flat-",
        ),
      );

    try {
      await writeFile(
        join(
          root,
          "artisan",
        ),
        "#!/usr/bin/env php\n",
      );

      await writeFile(
        join(
          root,
          "composer.json",
        ),
        "{}",
      );

      assert.equal(
        await resolveLaravelReleaseRoot(
          root,
        ),
        root,
      );
    } finally {
      await rm(
        root,
        {
          recursive: true,
          force: true,
        },
      );
    }
  },
);

test(
  "resolveLaravelReleaseRoot: detects Laravel inside one wrapper directory",
  async () => {
    const root =
      await mkdtemp(
        join(
          tmpdir(),
          "nexdeploy-wrapper-",
        ),
      );

    const wrapped =
      join(
        root,
        "NEXA-AI-Control-Center",
      );

    try {
      await mkdir(
        wrapped,
        {
          recursive: true,
        },
      );

      await writeFile(
        join(
          wrapped,
          "artisan",
        ),
        "#!/usr/bin/env php\n",
      );

      await writeFile(
        join(
          wrapped,
          "composer.json",
        ),
        "{}",
      );

      assert.equal(
        await resolveLaravelReleaseRoot(
          root,
        ),
        wrapped,
      );
    } finally {
      await rm(
        root,
        {
          recursive: true,
          force: true,
        },
      );
    }
  },
);

test(
  "resolveLaravelReleaseRoot: refuses ambiguous multiple Laravel roots",
  async () => {
    const root =
      await mkdtemp(
        join(
          tmpdir(),
          "nexdeploy-multiple-",
        ),
      );

    const first =
      join(
        root,
        "app-one",
      );

    const second =
      join(
        root,
        "app-two",
      );

    try {
      await mkdir(
        first,
        {
          recursive: true,
        },
      );

      await mkdir(
        second,
        {
          recursive: true,
        },
      );

      for (
        const candidate of [
          first,
          second,
        ]
      ) {
        await writeFile(
          join(
            candidate,
            "artisan",
          ),
          "#!/usr/bin/env php\n",
        );

        await writeFile(
          join(
            candidate,
            "composer.json",
          ),
          "{}",
        );
      }

      assert.equal(
        await resolveLaravelReleaseRoot(
          root,
        ),
        null,
      );
    } finally {
      await rm(
        root,
        {
          recursive: true,
          force: true,
        },
      );
    }
  },
);

test(
  "shouldRunComposer / shouldRunFrontendBuild reflect file presence",
  async () => {
    const root =
      await mkdtemp(
        join(
          tmpdir(),
          "nexdeploy-build-",
        ),
      );

    try {
      assert.equal(
        await shouldRunComposer(
          root,
        ),
        false,
      );

      assert.equal(
        await shouldRunFrontendBuild(
          root,
        ),
        false,
      );

      await writeFile(
        join(
          root,
          "composer.json",
        ),
        "{}",
      );

      await writeFile(
        join(
          root,
          "package.json",
        ),
        "{}",
      );

      assert.equal(
        await shouldRunComposer(
          root,
        ),
        true,
      );

      assert.equal(
        await shouldRunFrontendBuild(
          root,
        ),
        true,
      );
    } finally {
      await rm(
        root,
        {
          recursive: true,
          force: true,
        },
      );
    }
  },
);

test(
  "composerInstallCommand: production-safe flags",
  () => {
    const command =
      composerInstallCommand();

    assert.equal(
      command[0],
      "composer",
    );

    assert.ok(
      command.includes(
        "install",
      ),
    );

    assert.ok(
      command.includes(
        "--no-dev",
      ),
    );

    assert.ok(
      command.includes(
        "--prefer-dist",
      ),
    );

    assert.ok(
      command.includes(
        "--no-interaction",
      ),
    );

    assert.ok(
      command.includes(
        "--optimize-autoloader",
      ),
    );
  },
);

test(
  "frontendBuildCommand: uses npm ci with lockfile and npm install as fallback",
  () => {
    const command =
      frontendBuildCommand();

    assert.equal(
      command[0],
      "sh",
    );

    assert.equal(
      command[1],
      "-c",
    );

    assert.match(
      command[2],
      /package-lock\.json/,
    );

    assert.match(
      command[2],
      /npm ci/,
    );

    assert.match(
      command[2],
      /npm install/,
    );

    assert.match(
      command[2],
      /npm run build/,
    );
  },
);

test(
  "packageDiscoverCommand: production-safe command",
  () => {
    const command =
      packageDiscoverCommand();

    assert.deepEqual(
      command,
      [
        "php",
        "artisan",
        "package:discover",
        "--ansi",
      ],
    );
  },
);

test(
  "clearLaravelBootstrapCache: removes packages.php and services.php, no error if missing",
  async () => {
    const root =
      await mkdtemp(
        join(
          tmpdir(),
          "nexdeploy-clear-cache-",
        ),
      );

    const cacheDir =
      join(
        root,
        "bootstrap",
        "cache",
      );

    try {
      await mkdir(
        cacheDir,
        {
          recursive: true,
        },
      );

      const packages = join(cacheDir, "packages.php");
      const services = join(cacheDir, "services.php");

      // Test case 1: Files exist, should be removed
      await writeFile(packages, "test");
      await writeFile(services, "test");

      await clearLaravelBootstrapCache(root);

      await assert.rejects(access(packages), { code: "ENOENT" });
      await assert.rejects(access(services), { code: "ENOENT" });

      // Test case 2: Files do not exist, should not throw
      await assert.doesNotReject(clearLaravelBootstrapCache(root));
    } finally {
      await rm(
        root,
        {
          recursive: true,
          force: true,
        },
      );
    }
  },
);

test(
  "buildRuntimeEnvironment: safe production defaults, no DB provisioning yet",
  () => {
    const env =
      buildRuntimeEnvironment();

    assert.equal(
      env.APP_ENV,
      "production",
    );

    assert.equal(
      env.APP_DEBUG,
      "false",
    );

    assert.match(
      env.APP_KEY,
      /^base64:/,
    );

    assert.equal(
      env.LOG_CHANNEL,
      "stderr",
    );

    assert.equal(
      env.DB_CONNECTION,
      "sqlite",
    );

    assert.equal(
      env.DB_DATABASE,
      "/dev/null",
    );
  },
);

test(
  "buildEntrypointCommand: serves on CONTAINER_PORT and is storage-link tolerant",
  () => {
    const command =
      buildEntrypointCommand();

    assert.equal(
      command[0],
      "sh",
    );

    assert.equal(
      command[1],
      "-c",
    );

    assert.match(
      command[2],
      /artisan storage:link \|\| true/,
    );

    assert.match(
      command[2],
      new RegExp(
        `--port=${CONTAINER_PORT}`,
      ),
    );
  },
);

test(
  "mergeEnvFile: overrides known keys, preserves unknown ones",
  () => {
    const merged =
      mergeEnvFile(
        [
          "APP_ENV=local",
          "APP_DEBUG=true",
          "MAIL_MAILER=smtp",
          "",
        ].join(
          "\n",
        ),
        {
          APP_ENV:
            "production",
          APP_DEBUG:
            "false",
        },
      );

    assert.match(
      merged,
      /APP_ENV=production/,
    );

    assert.match(
      merged,
      /APP_DEBUG=false/,
    );

    assert.match(
      merged,
      /MAIL_MAILER=smtp/,
    );
  },
);

test(
  "mergeEnvFile: adds override keys missing from the source file",
  () => {
    const merged =
      mergeEnvFile(
        "APP_ENV=local\n",
        {
          APP_ENV:
            "production",
          LOG_CHANNEL:
            "stderr",
        },
      );

    assert.match(
      merged,
      /APP_ENV=production/,
    );

    assert.match(
      merged,
      /LOG_CHANNEL=stderr/,
    );
  },
);

test(
  "mergeEnvFile: does not clobber an already-set non-empty APP_KEY",
  () => {
    const merged =
      mergeEnvFile(
        "APP_KEY=base64:existingkey==\n",
        {
          APP_KEY:
            "base64:newkey==",
        },
      );

    assert.match(
      merged,
      /APP_KEY=base64:existingkey==/,
    );

    assert.doesNotMatch(
      merged,
      /APP_KEY=base64:newkey==/,
    );
  },
);

test(
  "mergeEnvFile: never leaks the generated key or secrets to a thrown error (sanity: pure string op)",
  () => {
    assert.doesNotThrow(
      () =>
        mergeEnvFile(
          "",
          buildRuntimeEnvironment(),
        ),
    );
  },
);

test(
  "summarizeFailure: keeps only the last few meaningful lines",
  () => {
    const source =
      Array.from(
        {
          length: 12,
        },
        (
          _,
          index,
        ) =>
          `line-${index + 1}`,
      ).join(
        "\n",
      );

    const summarized =
      summarizeFailure(
        source,
      );

    assert.doesNotMatch(
      summarized,
      /line-1\n/,
    );

    assert.match(
      summarized,
      /line-12/,
    );
  },
);

test(
  "summarizeFailure: handles empty input",
  () => {
    assert.equal(
      summarizeFailure(
        "",
      ),
      "Perintah Laravel gagal tanpa pesan.",
    );
  },
);
test(
  "queue worker command uses Laravel queue:work",
  () => {
    const command =
      buildQueueWorkerCommand();

    assert.deepStrictEqual(
      command.slice(
        0,
        3,
      ),
      [
        "php",
        "artisan",
        "queue:work",
      ],
    );

    assert.ok(
      command.includes(
        "--tries=3",
      ),
    );

    assert.ok(
      command.includes(
        "--timeout=90",
      ),
    );
  },
);

test(
  "scheduler command uses Laravel schedule:work",
  () => {
    const command =
      buildSchedulerCommand();

    assert.deepStrictEqual(
      command.slice(
        0,
        3,
      ),
      [
        "php",
        "artisan",
        "schedule:work",
      ],
    );
  },
);

test(
  "production runtime defaults queue to database",
  () => {
    const env =
      buildRuntimeEnvironment();

    assert.equal(
      env.QUEUE_CONNECTION,
      "database",
    );
  },
);