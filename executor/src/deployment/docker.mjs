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
      stdout += chunk;

      if (stdout.length > MAX_OUTPUT_BYTES) {
        stdout =
          stdout.slice(
            -MAX_OUTPUT_BYTES,
          );

        stdoutOverflow = true;
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;

      if (stderr.length > MAX_OUTPUT_BYTES) {
        stderr =
          stderr.slice(
            -MAX_OUTPUT_BYTES,
          );

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
            stderr.slice(-2000) ||
            stdout.slice(-2000) ||
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

export async function ensureNetwork(name, labels = [], internal = false) {
  assertName(name, "network");

  if (await networkExists(name)) {
    return name;
  }

  const args = [
    "network",
    "create",
    "--driver",
    "bridge",
    ...(internal ? ["--internal"] : []),
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
  additionalNetworks = [],
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
  ];

  for (const net of additionalNetworks) {
    args.push("--network", net);
  }

  args.push(
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
  );

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

  args.push(
    image,
    ...command,
  );

  return args;
}

export function buildStartBackgroundContainerArgs({
  name,
  image,
  network,
  additionalNetworks = [],
  env = {},
  envFile = null,
  labels = [],
  volumes = [],
  command = [],
}) {
  assertName(name, "container");
  assertName(network, "network");

  const args = [
    "run",
    "-d",
    "--name",
    name,
    "--network",
    network,
    "--restart",
    "unless-stopped",
  ];

  for (const net of additionalNetworks) {
    assertName(net, "network");
    args.push(
      "--network",
      net,
    );
  }

  args.push(
    ...labels.flatMap((entry) => [
      "--label",
      entry,
    ]),

    ...(envFile
      ? [
          "--env-file",
          envFile,
        ]
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

    image,

    ...command,
  );

  return args;
}

export async function startBackgroundContainer(
  options,
) {
  await removeContainerIfExists(
    options.name,
  );

  return runDocker(
    buildStartBackgroundContainerArgs(
      options,
    ),
  );
}
export async function startContainer(options) {
  await removeContainerIfExists(
    options.name,
  );

  const args =
    buildStartContainerArgs(
      options,
    );

  return runDocker(args);
}

export async function getContainerHostPort(name, containerPort) {
  assertName(name, "container");
  const output = await runDocker([
    "container",
    "inspect",
    name,
    "--format",
    "{{json .NetworkSettings.Ports}}",
  ]);
  const ports = JSON.parse(output.trim());
  const key = `${containerPort}/tcp`;
  if (ports[key] && ports[key][0] && ports[key][0].HostPort) {
    return Number.parseInt(ports[key][0].HostPort, 10);
  }
  throw new Error(
    `Host port tidak ditemukan untuk container ${name} pada port ${containerPort}`,
  );
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

export function startExistingContainer(name) {
  assertName(name, "container");

  return runDocker([
    "container",
    "start",
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
  additionalNetworks = [],
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
  ];

  for (const net of additionalNetworks) {
    args.push("--network", net);
  }

  args.push(
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
  );

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
  "buildx",
  "build",
  "--load",
  "--progress=plain",
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
  assertName(
    name,
    "container",
  );

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

export async function containerHttpHealthy(
  name,
  port,
) {
  assertName(
    name,
    "container",
  );

  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error(
      `port health check tidak valid: ${port}`,
    );
  }

  const phpCode = `
$errno = 0;
$errstr = "";

$socket = @fsockopen(
    "127.0.0.1",
    ${port},
    $errno,
    $errstr,
    3
);

if (!$socket) {
    exit(1);
}

fwrite(
    $socket,
    "GET / HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n"
);

$status = fgets($socket);
fclose($socket);

if (!$status) {
    exit(1);
}

if (
    preg_match(
        '/^HTTP\\/\\d(?:\\.\\d)?\\s+(\\d{3})/',
        $status,
        $matches
    )
) {
    $code = (int) $matches[1];

    if ($code < 500) {
        echo $code;
        exit(0);
    }
}

exit(1);
`;

  try {
    await runDocker([
      "exec",
      name,
      "php",
      "-r",
      phpCode,
    ]);

    return true;
  } catch {
    return false;
  }
}

export async function listImagesByLabel(
  resourceLabel,
) {
  const output =
    await runDocker([
      "image",
      "ls",
      "--filter",
      `label=${resourceLabel}`,
      "--format",
      "{{.Repository}}:{{.Tag}}",
    ]);

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !line.endsWith(":<none>"),
    );
}

export async function removeImagesByLabel(
  resourceLabel,
) {
  const images =
    await listImagesByLabel(
      resourceLabel,
    );

  const removed = [];

  for (const image of images) {
    await runDocker(
      [
        "image",
        "rm",
        "-f",
        image,
      ],
      {
        allowExitCodes: [
          0,
          1,
        ],
      },
    );

    removed.push(image);
  }

  return removed;
}
