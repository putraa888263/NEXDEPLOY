import { access } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export const LARAVEL_PHP_VERSION = "8.3";

export const LARAVEL_RUNTIME_IMAGE =
  `nexdeploy/laravel-runtime:php-${LARAVEL_PHP_VERSION}`;

export const CONTAINER_PORT = 8080;

export function isLaravelRelease(releasePath) {
  return Promise.all([
    access(join(releasePath, "artisan")).then(
      () => true,
      () => false,
    ),
    access(join(releasePath, "composer.json")).then(
      () => true,
      () => false,
    ),
  ]).then(
    ([hasArtisan, hasComposer]) =>
      hasArtisan && hasComposer,
  );
}

export function shouldRunComposer(releasePath) {
  return access(
    join(releasePath, "composer.json"),
  ).then(
    () => true,
    () => false,
  );
}

export function shouldRunFrontendBuild(releasePath) {
  return access(
    join(releasePath, "package.json"),
  ).then(
    () => true,
    () => false,
  );
}

export function composerInstallCommand() {
  return [
    "composer",
    "install",
    "--no-dev",
    "--prefer-dist",
    "--no-interaction",
    "--optimize-autoloader",
    "--no-scripts",
  ];
}

export function frontendBuildCommand() {
  return [
    "sh",
    "-c",
    "test -f package-lock.json || { echo 'package-lock.json wajib tersedia untuk build frontend deterministic.' >&2; exit 2; }; npm ci --no-audit --no-fund && npm run build",
  ];
}

export function appKey() {
  return `base64:${randomBytes(32).toString("base64")}`;
}

export function buildRuntimeEnvironment() {
  return {
    APP_ENV: "production",
    APP_DEBUG: "false",
    APP_KEY: appKey(),
    LOG_CHANNEL: "stderr",

    // Phase 1 belum provisioning database.
    DB_CONNECTION: "sqlite",
    DB_DATABASE: "/dev/null",

    CACHE_DRIVER: "array",
    SESSION_DRIVER: "array",
    QUEUE_CONNECTION: "sync",
  };
}

export function buildEntrypointCommand() {
  return [
    "sh",
    "-c",
    `set -e; cd /var/www/html; (php artisan storage:link || true); (php artisan optimize:clear || true); exec php artisan serve --host=0.0.0.0 --port=${CONTAINER_PORT}`,
  ];
}

export function mergeEnvFile(
  existingContents,
  overrides,
) {
  const lines =
    (existingContents ?? "")
      .split(/\r?\n/);

  const seen =
    new Set();

  const merged =
    lines.map((line) => {
      const match =
        line.match(
          /^([A-Z0-9_]+)=(.*)$/,
        );

      if (!match) {
        return line;
      }

      const [, key, value] =
        match;

      if (!(key in overrides)) {
        return line;
      }

      seen.add(key);

      if (
        key === "APP_KEY" &&
        value.trim().length > 0
      ) {
        return line;
      }

      return `${key}=${overrides[key]}`;
    });

  for (
    const [key, value]
      of Object.entries(overrides)
  ) {
    if (!seen.has(key)) {
      merged.push(
        `${key}=${value}`,
      );
    }
  }

  return (
    merged
      .filter(
        (line, index, all) =>
          !(
            line === "" &&
            all[index - 1] === ""
          ),
      )
      .join("\n") +
    "\n"
  );
}

function stripAnsi(value) {
  const escape =
    String.fromCharCode(27);

  const pattern =
    new RegExp(
      `${escape}\\[[0-9;]*[a-zA-Z]`,
      "g",
    );

  return String(value ?? "")
    .replace(pattern, "");
}

export function summarizeFailure(stderr) {
  if (!stderr) {
    return "Perintah Laravel gagal tanpa pesan.";
  }

  const lines =
    stripAnsi(stderr)
      .split(/\r?\n/)
      .filter(
        (line) =>
          line.trim().length > 0,
      );

  return lines
    .slice(-6)
    .join("\n");
}