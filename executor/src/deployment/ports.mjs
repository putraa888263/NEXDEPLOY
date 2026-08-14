import { spawn } from "node:child_process";

export const DEFAULTS = Object.freeze({
  min: 20000,
  max: 29999,
  reserved: [8088, 8787],
});

function parseIntEnv(name, fallback) {
  const raw = process.env[name];

  if (raw === undefined || raw === "") {
    return fallback;
  }

  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} harus berupa integer.`);
  }

  const value = Number.parseInt(raw, 10);

  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} tidak valid.`);
  }

  return value;
}

export function portRange() {
  const min = parseIntEnv(
    "DEPLOY_PORT_MIN",
    DEFAULTS.min,
  );

  const max = parseIntEnv(
    "DEPLOY_PORT_MAX",
    DEFAULTS.max,
  );

  if (
    min < 1 ||
    max > 65535 ||
    min > max
  ) {
    throw new Error(
      `DEPLOY_PORT_MIN/DEPLOY_PORT_MAX tidak valid: ${min}-${max}.`,
    );
  }

  return {
    min,
    max,
  };
}

function commandLines(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      args[0],
      args.slice(1),
      {
        windowsHide: true,
      },
    );

    let output = "";
    let errorOutput = "";

    child.stdout.on("data", (chunk) => {
      output += chunk;
    });

    child.stderr.on("data", (chunk) => {
      errorOutput += chunk;
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve(output);
        return;
      }

      reject(
        new Error(
          `${args[0]} gagal dengan exit ${code}: ${errorOutput.slice(0, 300)}`,
        ),
      );
    });
  });
}

/**
 * Parse output `ss -ltnH`.
 *
 * Example:
 * LISTEN 0 4096 10.90.100.3:8088 0.0.0.0:*
 * LISTEN 0 4096 [::]:9443 [::]:*
 *
 * Local address is normally column index 3.
 */
export function parseListeningPorts(output) {
  const ports = new Set();

  for (const line of String(output ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    const columns = trimmed.split(/\s+/);

    if (columns.length < 4) {
      continue;
    }

    const localAddress = columns[3];

    const match =
      localAddress.match(/:(\d+)$/);

    if (!match) {
      continue;
    }

    const port =
      Number.parseInt(match[1], 10);

    if (
      Number.isInteger(port) &&
      port >= 1 &&
      port <= 65535
    ) {
      ports.add(port);
    }
  }

  return [...ports];
}

/**
 * Parse Docker published port strings.
 *
 * Examples:
 * 0.0.0.0:8095->80/tcp
 * [::]:8095->80/tcp
 * 10.90.100.3:8088->3000/tcp
 * 127.0.0.1:9100->9100/tcp
 */
export function parseDockerPublishedPorts(output) {
  const ports = new Set();

  for (const line of String(output ?? "").split(/\r?\n/)) {
    const matches =
      line.matchAll(
        /(?:^|,\s*|\s)(?:\d{1,3}(?:\.\d{1,3}){3}|\[[^\]]+\]|[^,\s:]+)?:(\d+)->\d+(?:\/[a-z]+)?/gi,
      );

    for (const match of matches) {
      const port =
        Number.parseInt(
          match[1],
          10,
        );

      if (
        Number.isInteger(port) &&
        port >= 1 &&
        port <= 65535
      ) {
        ports.add(port);
      }
    }
  }

  return [...ports];
}

async function listeningPorts() {
  const output =
    await commandLines([
      "ss",
      "-ltnH",
    ]);

  return parseListeningPorts(
    output,
  );
}

async function dockerPublishedPorts() {
  const output =
    await commandLines([
      "docker",
      "ps",
      "--format",
      "{{.Ports}}",
    ]);

  return parseDockerPublishedPorts(
    output,
  );
}

export async function buildExclusionSet() {
  const reserved =
    new Set(
      DEFAULTS.reserved,
    );

  try {
    for (
      const port of
      await listeningPorts()
    ) {
      reserved.add(port);
    }
  } catch {
    // `ss` mungkin tidak tersedia.
    // Docker-published ports tetap diperiksa berikutnya.
  }

  try {
    for (
      const port of
      await dockerPublishedPorts()
    ) {
      reserved.add(port);
    }
  } catch {
    // Docker CLI mungkin tidak tersedia di environment test.
  }

  return reserved;
}

export async function allocateHostPort(
  exclusion = null,
) {
  const {
    min,
    max,
  } = portRange();

  const excluded =
    exclusion ??
    (await buildExclusionSet());

  for (
    let port = min;
    port <= max;
    port += 1
  ) {
    if (
      !excluded.has(port)
    ) {
      // Reservation in-memory mengurangi collision dalam proses executor
      // yang sama. Docker sendiri tetap menjadi final authority saat bind.
      excluded.add(port);

      return port;
    }
  }

  throw new Error(
    `Tidak ada host port kosong pada rentang ${min}-${max}.`,
  );
}

export function isValidPort(
  port,
  range = portRange(),
) {
  return (
    Number.isInteger(port) &&
    port >= range.min &&
    port <= range.max
  );
}