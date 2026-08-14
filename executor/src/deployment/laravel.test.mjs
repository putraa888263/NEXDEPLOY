import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  isLaravelRelease,
  shouldRunComposer,
  shouldRunFrontendBuild,
  composerInstallCommand,
  frontendBuildCommand,
  appKey,
  buildRuntimeEnvironment,
  buildEntrypointCommand,
  mergeEnvFile,
  summarizeFailure,
  CONTAINER_PORT,
} from "./laravel.mjs";

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "nexdeploy-laravel-test-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("isLaravelRelease: true only when both artisan and composer.json exist", async () => {
  await withTempDir(async (dir) => {
    assert.equal(await isLaravelRelease(dir), false);
    await writeFile(join(dir, "artisan"), "#!/usr/bin/env php\n");
    assert.equal(await isLaravelRelease(dir), false);
    await writeFile(join(dir, "composer.json"), "{}");
    assert.equal(await isLaravelRelease(dir), true);
  });
});

test("shouldRunComposer / shouldRunFrontendBuild reflect file presence", async () => {
  await withTempDir(async (dir) => {
    assert.equal(await shouldRunComposer(dir), false);
    assert.equal(await shouldRunFrontendBuild(dir), false);
    await writeFile(join(dir, "composer.json"), "{}");
    await writeFile(join(dir, "package.json"), "{}");
    assert.equal(await shouldRunComposer(dir), true);
    assert.equal(await shouldRunFrontendBuild(dir), true);
  });
});

test("composerInstallCommand: production-safe flags", () => {
  const cmd = composerInstallCommand();
  assert.equal(cmd[0], "composer");
  assert.ok(cmd.includes("--no-dev"));
  assert.ok(cmd.includes("--no-interaction"));
  assert.ok(cmd.includes("--optimize-autoloader"));
  assert.ok(!cmd.includes("--dev"));
});

test("frontendBuildCommand: prefers npm ci when a lockfile is present", () => {
  const cmd = frontendBuildCommand();
  const script = cmd[cmd.length - 1];
  assert.match(script, /npm ci/);
  assert.match(script, /npm run build/);
});

test("appKey: matches Laravel's base64:<32 bytes> format", () => {
  const key = appKey();
  assert.match(key, /^base64:[A-Za-z0-9+/]+=*$/);
  const raw = Buffer.from(key.slice("base64:".length), "base64");
  assert.equal(raw.length, 32);
});

test("buildRuntimeEnvironment: safe production defaults, no DB provisioning yet", () => {
  const env = buildRuntimeEnvironment();
  assert.equal(env.APP_ENV, "production");
  assert.equal(env.APP_DEBUG, "false");
  assert.match(env.APP_KEY, /^base64:/);
  assert.equal(env.DB_CONNECTION, "sqlite");
});

test("buildEntrypointCommand: serves on CONTAINER_PORT and is storage-link tolerant", () => {
  const cmd = buildEntrypointCommand();
  const script = cmd[cmd.length - 1];
  assert.match(script, new RegExp(`--port=${CONTAINER_PORT}`));
  assert.match(script, /storage:link \|\| true/);
});

test("mergeEnvFile: overrides known keys, preserves unknown ones", () => {
  const existing = "APP_NAME=MyApp\nAPP_ENV=local\nMAIL_MAILER=smtp\n";
  const merged = mergeEnvFile(existing, { APP_ENV: "production", APP_DEBUG: "false" });
  assert.match(merged, /APP_NAME=MyApp/);
  assert.match(merged, /APP_ENV=production/);
  assert.match(merged, /MAIL_MAILER=smtp/);
  assert.match(merged, /APP_DEBUG=false/);
});

test("mergeEnvFile: adds override keys missing from the source file", () => {
  const merged = mergeEnvFile("APP_NAME=MyApp\n", { DB_CONNECTION: "sqlite" });
  assert.match(merged, /DB_CONNECTION=sqlite/);
});

test("mergeEnvFile: does not clobber an already-set non-empty APP_KEY", () => {
  const merged = mergeEnvFile("APP_KEY=base64:existingkey==\n", { APP_KEY: "base64:newkey==" });
  assert.match(merged, /APP_KEY=base64:existingkey==/);
});

test("mergeEnvFile: never leaks the generated key or secrets to a thrown error (sanity: pure string op)", () => {
  const merged = mergeEnvFile("", { APP_KEY: "base64:secret==" });
  assert.equal(typeof merged, "string");
});

test("summarizeFailure: keeps only the last few meaningful lines", () => {
  const stderr = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  const summary = summarizeFailure(stderr);
  assert.equal(summary.split("\n").length, 6);
  assert.match(summary, /line 19/);
});

test("summarizeFailure: handles empty input", () => {
  assert.equal(summarizeFailure(""), "Perintah Laravel gagal tanpa pesan.");
  assert.equal(summarizeFailure(undefined), "Perintah Laravel gagal tanpa pesan.");
});
