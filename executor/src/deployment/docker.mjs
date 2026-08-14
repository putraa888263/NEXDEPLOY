import { spawn } from "node:child_process";

const MAX_OUTPUT_BYTES = 8 * 1024;

function runDocker(args, { allowExitCodes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let stdoutOverflow = false;
    let stderrOverflow = false;

    child.stdout.on("data", (chunk) => {
      if (stdout.length < MAX_OUTPUT_BYTES) {
        stdout += chunk;

        if (stdout.length > MAX_OUTPUT_BYTES) {
          stdout = stdout.slice(0, MAX_OUTPUT_BYTES);
          stdoutOverflow = true;
        }
      } else {
        stdoutOverflow = true;
      }
    });

    child.stderr.on("data", (chunk) => {
      if (stderr.length < MAX_OUTPUT_BYTES) {
        stderr += chunk;

        if (stderr.length > MAX_OUTPUT_BYTES) {
          stderr = stderr.slice(0, MAX_OUTPUT_BYTES);
          stderrOverflow = true;
        }
      } else {
        stderrOverflow = true;
      }
    });

    child.on("error", reject);

    child.on("close", (code) => {
      const output =
        stdout +
        (stdoutOverflow ? "\n…(stdout truncated)" : "") +
        (stderr ? `\n${stderr}` : "") +
        (stderrOverflow ? "\n…(stderr truncated)" : "");

      if (allowExitCodes.includes(code)) {
        resolve(output);
        return;
      }

      reject(
        new Error(
          `docker ${args[0]} exit ${code}: ${
            stderr.slice(0, 400) ||
            stdout.slice(0, 400) ||
            "Docker command gagal."
          }`,
        ),
      );
    });
  });
}

function assertName(name, label) {
  if (
    typeof name !== "string" ||
    !/^[a-zA-Z0-9_.-]+$/.test(name)
  ) {
    throw new Error(
      `Nama ${label} tidak aman: ${String(name).slice(0, 80)}`,
    );
  }

  return name;
}

export function networkExists(name) {
  assertName(name, "network");

  return runDocker([
    "network",
    "inspect",
    name,
    "--format",
    "{{.Id}}",
  ]).then(
    (output) => output.trim().length > 0,
    () => false,
  );
}

export async function ensureNetwork(name, labels = []) {
  assertName(name, "network");

  if (await networkExists(name)) {
    return name;
  }

  const args = [
    "network",
    "create",
    "--driver",
    "bridge",
    ...labels.flatMap((entry) => [
      "--label",
      entry,
    ]),
    name,
  ];

  await runDocker(args);

  return name;
}

export function containerExists(name) {
  assertName(name, "container");

  return runDocker([
    "container",
    "inspect",
    name,
    "--format",
    "{{.Id}}",
  ]).then(
    (output) => output.trim().length > 0,
    () => false,
  );
}

export async function removeContainerIfExists(name) {
  assertName(name, "container");

  if (await containerExists(name)) {
    await runDocker([
      "container",
      "rm",
      "-f",
      name,
    ]);
  }
}

export function buildStartContainerArgs({
  name,
  image,
  network,
  hostPort,
  containerPort,
  env = {},
  envFile = null,
  labels = [],
  volumes = [],
  command = [],
  healthcheck = null,
}) {
  assertName(name, "container");
  assertName(network, "network");

  if (
    !Number.isInteger(hostPort) ||
    hostPort < 1 ||
    hostPort > 65535
  ) {
    throw new Error(`hostPort tidak valid: ${hostPort}`);
  }

  if (
    !Number.isInteger(containerPort) ||
    containerPort < 1 ||
    containerPort > 65535
  ) {
    throw new Error(
      `containerPort tidak valid: ${containerPort}`,
    );
  }

  const args = [
    "run",
    "-d",
    "--name",
    name,
    "--network",
    network,
    "--restart",
    "unless-stopped",
    "-p",
    `${hostPort}:${containerPort}`,

    ...labels.flatMap((entry) => [
      "--label",
      entry,
    ]),

    ...(envFile
      ? ["--env-file", envFile]
      : []),

    ...Object.entries(env).flatMap(
      ([key, value]) => [
        "-e",
        `${key}=${value}`,
      ],
    ),

    ...volumes.flatMap((entry) => [
      "-v",
      entry,
    ]),
  ];

  // Semua opsi `docker run` harus berada sebelum nama image.
  if (healthcheck) {
    args.push(
      "--health-cmd",
      healthcheck.cmd,
    );

    args.push(
      "--health-interval",
      healthcheck.interval ?? "10s",
    );

    args.push(
      "--health-timeout",
      healthcheck.timeout ?? "5s",
    );

    args.push(
      "--health-retries",
      String(healthcheck.retries ?? 3),
    );

    args.push(
      "--health-start-period",
      healthcheck.startPeriod ?? "20s",
    );
  }

  // Image harus diletakkan setelah seluruh opsi docker run.
  args.push(
    image,
    ...command,
  );

  return args;
}

export async function startContainer(options) {
  // Candidate container memiliki nama job-specific.
  // Container deployment lama tidak disentuh pada tahap ini.
  await removeContainerIfExists(
    options.name,
  );

  const args =
    buildStartContainerArgs(
      options,
    );

  return runDocker(args);
}

export async function containerRunning(name) {
  assertName(name, "container");

  const output =
    await runDocker([
      "container",
      "inspect",
      name,
      "--format",
      "{{.State.Running}}",
    ]);

  return output.trim() === "true";
}

export function stopContainer(
  name,
  { timeoutSeconds = 10 } = {},
) {
  assertName(name, "container");

  return runDocker([
    "container",
    "stop",
    "-t",
    String(timeoutSeconds),
    name,
  ]);
}

export function removeNetwork(name) {
  assertName(name, "network");

  return runDocker(
    [
      "network",
      "rm",
      name,
    ],
    {
      allowExitCodes: [0, 1, 2],
    },
  );
}

export async function runOneShot({
  image,
  network = null,
  command,
  volumes = [],
  workdir = "/var/www/html",
  env = {},
  labels = [],
  allowExitCodes = [0],
}) {
  const args = [
    "run",
    "--rm",

    ...labels.flatMap((entry) => [
      "--label",
      entry,
    ]),

    ...(network
      ? ["--network", network]
      : []),

    ...volumes.flatMap((entry) => [
      "-v",
      entry,
    ]),

    ...Object.entries(env).flatMap(
      ([key, value]) => [
        "-e",
        `${key}=${value}`,
      ],
    ),

    "-w",
    workdir,

    image,

    ...command,
  ];

  return runDocker(
    args,
    {
      allowExitCodes,
    },
  );
}

const SAFE_IMAGE_TAG =
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*:[a-zA-Z0-9_.-]+$/;

export async function buildImage({
  dockerfile,
  context,
  tag,
  labels = [],
}) {
  if (
    typeof tag !== "string" ||
    !SAFE_IMAGE_TAG.test(tag)
  ) {
    throw new Error(
      `Nama image tidak aman: ${String(tag).slice(0, 80)}`,
    );
  }

  const args = [
    "build",
    "-f",
    dockerfile,
    "-t",
    tag,

    ...labels.flatMap((entry) => [
      "--label",
      entry,
    ]),

    context,
  ];

  return runDocker(
    args,
    {
      allowExitCodes: [0],
    },
  );
}

export async function listContainersByLabel(
  resourceLabel,
) {
  const output =
    await runDocker([
      "ps",
      "-a",
      "--filter",
      `label=${resourceLabel}`,
      "--format",
      "{{.Names}}",
    ]);

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function diagnoseContainer(
  name,
  lines = 80,
) {
  assertName(name, "container");

  try {
    const logs =
      await runDocker([
        "container",
        "logs",
        "--tail",
        String(lines),
        name,
      ]);

    const escape =
  String.fromCharCode(27);

const pattern =
  new RegExp(
    `${escape}\\[[0-9;]*[a-zA-Z]`,
    "g",
  );

return logs
  .replace(
    pattern,
    "",
  )
  .trim();
  } catch {
    return "";
  }
}