import { promises as fs } from "node:fs";
import path from "node:path";

const ENV_KEY_PATTERN =
  /^[A-Z_][A-Z0-9_]*$/;

export const PROTECTED_ENV_KEYS =
  new Set([
    "APP_KEY",
    "DB_CONNECTION",
    "DB_HOST",
    "DB_PORT",
    "DB_DATABASE",
    "DB_USERNAME",
    "DB_PASSWORD",
  ]);

export function validateEnvironmentKey(
  key,
) {
  if (
    typeof key !== "string" ||
    !ENV_KEY_PATTERN.test(key)
  ) {
    throw new Error(
      "Nama environment variable tidak valid.",
    );
  }

  if (
    PROTECTED_ENV_KEYS.has(key)
  ) {
    throw new Error(
      `Environment variable ${key} dikelola oleh NEXDEPLOY.`,
    );
  }

  return key;
}

export function normalizeUserEnvironment(
  input,
) {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    throw new Error(
      "Environment variables harus berupa object.",
    );
  }

  const normalized = {};

  for (
    const [key, value] of
      Object.entries(input)
  ) {
    validateEnvironmentKey(key);

    if (
      typeof value !== "string"
    ) {
      throw new Error(
        `Nilai environment variable ${key} harus berupa string.`,
      );
    }

    if (
      value.includes("\0")
    ) {
      throw new Error(
        `Nilai environment variable ${key} tidak valid.`,
      );
    }

    normalized[key] =
      value;
  }

  return normalized;
}

export async function saveProjectEnvironment(
  projectsDir,
  projectId,
  environment,
) {
  const normalized =
    normalizeUserEnvironment(
      environment,
    );

  const projectDir =
    path.join(
      projectsDir,
      projectId,
    );

  const target =
    path.join(
      projectDir,
      ".nexdeploy-environment.json",
    );

  const temp =
    `${target}.tmp`;

  await fs.mkdir(
    projectDir,
    {
      recursive: true,
    },
  );

  await fs.writeFile(
    temp,
    JSON.stringify(
      {
        version: 1,
        environment:
          normalized,
        updatedAt:
          new Date().toISOString(),
      },
      null,
      2,
    ),
    {
      mode: 0o600,
    },
  );

  await fs.rename(
    temp,
    target,
  );

  return normalized;
}

export async function loadProjectEnvironment(
  projectsDir,
  projectId,
) {
  const target =
    path.join(
      projectsDir,
      projectId,
      ".nexdeploy-environment.json",
    );

  let parsed;

  try {
    parsed =
      JSON.parse(
        await fs.readFile(
          target,
          "utf8",
        ),
      );
  } catch (error) {
    if (
      error?.code === "ENOENT"
    ) {
      return {};
    }

    throw new Error(
      "Gagal membaca environment project.",
    );
  }

  if (
    !parsed ||
    parsed.version !== 1 ||
    typeof parsed.environment !==
      "object" ||
    parsed.environment === null ||
    Array.isArray(
      parsed.environment,
    )
  ) {
    throw new Error(
      "Metadata environment project tidak valid.",
    );
  }

  return normalizeUserEnvironment(
    parsed.environment,
  );
}
