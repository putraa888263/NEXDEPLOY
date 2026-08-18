import {
  createServer,
} from "node:http";



import {
  mkdir,
  access,
  readFile,
  writeFile,
  rm,
  chmod,
} from "node:fs/promises";

import {
  spawn,
} from "node:child_process";

import {
  join,
  resolve,
  basename,
  dirname,
} from "node:path";

import {
  fileURLToPath,
} from "node:url";

import {
  randomUUID,
} from "node:crypto";

import {
  safeSlug,
  containerName,
  networkName,
  imageName,
  label,
  PROJECT_LABEL_KEY,
  JOB_LABEL_KEY,
} from "./deployment/naming.mjs";

import {
  allocateHostPort,
} from "./deployment/ports.mjs";

import {
  ensureNetwork,
  startContainer,
  buildImage,
  runOneShot,
  listContainersByLabel,
  removeContainerIfExists,
  diagnoseContainer,
  containerHttpHealthy,
  getContainerHostPort,
} from "./deployment/docker.mjs";

import {
  ensureProjectDatabase,
} from "./deployment/postgres.mjs";

import {
  resolveLaravelReleaseRoot,
  shouldRunComposer,
  shouldRunFrontendBuild,
  composerInstallCommand,
  frontendBuildCommand,
  buildEntrypointCommand,
  buildRuntimeEnvironment,
  mergeEnvFile,
  summarizeFailure,
  CONTAINER_PORT,
  clearLaravelBootstrapCache,
  packageDiscoverCommand,
} from "./deployment/laravel.mjs";

const executorDir =
  dirname(
    fileURLToPath(
      import.meta.url,
    ),
  );

const laravelDockerfile =
  resolve(
    executorDir,
    "..",
    "tpl",
    "laravel.Dockerfile",
  );

class DeployStageError extends Error {
  constructor(
    stage,
    message,
  ) {
    super(message);

    this.stage =
      stage;
  }
}

async function loadLocalEnvironment() {
  try {
    const source =
      await readFile(
        new URL(
          "../.env",
          import.meta.url,
        ),
        "utf8",
      );

    for (
      const line of source.split(
        /\r?\n/,
      )
    ) {
      const match =
        line.match(
          /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/,
        );

      if (
        match &&
        process.env[
          match[1]
        ] === undefined
      ) {
        process.env[
          match[1]
        ] =
          match[2].replace(
            /^['"]|['"]$/g,
            "",
          );
      }
    }
  } catch (error) {
    if (
      error?.code !==
      "ENOENT"
    ) {
      throw error;
    }
  }
}

await loadLocalEnvironment();

const port =
  Number(
    process.env.PORT ||
      8787,
  );

const host =
  process.env.HOST ||
  "127.0.0.1";

const token =
  process.env.EXECUTOR_TOKEN;

const projectsDir =
  resolve(
    process.env.PROJECTS_DIR ||
      "./executor-work",
  );

  const projectsVolume =
  process.env.PROJECTS_VOLUME ||
  "nexdeploy_executor-projects";


const stateDir =
  join(
    projectsDir,
    ".nexdeploy",
    "jobs",
  );

const jobs =
  new Map();

if (!token) {
  throw new Error(
    "EXECUTOR_TOKEN wajib diisi di executor/.env sebelum executor dijalankan.",
  );
}

function json(
  response,
  status,
  responseBody,
) {
  response.writeHead(
    status,
    {
      "content-type":
        "application/json",
    },
  );

  response.end(
    JSON.stringify(
      responseBody,
    ),
  );
}

async function body(
  request,
) {
  let raw = "";

  for await (
    const part of request
  ) {
    raw += part;
  }

  return raw
    ? JSON.parse(raw)
    : {};
}

function authorized(
  request,
) {
  return (
    request.headers
      .authorization ===
    `Bearer ${token}`
  );
}

function jobFile(id) {
  return join(
    stateDir,
    `${id}.json`,
  );
}

async function save(job) {
  await mkdir(
    stateDir,
    {
      recursive: true,
    },
  );

  await writeFile(
    jobFile(
      job.id,
    ),
    JSON.stringify(
      job,
      null,
      2,
    ),
  );
}

async function load(id) {
  if (
    jobs.has(id)
  ) {
    return jobs.get(
      id,
    );
  }

  try {
    const job =
      JSON.parse(
        await readFile(
          jobFile(id),
          "utf8",
        ),
      );

    jobs.set(
      id,
      job,
    );

    return job;
  } catch {
    return null;
  }
}

async function log(
  job,
  level,
  message,
) {
  job.logs.push({
    at:
      new Date().toISOString(),
    level,
    message,
  });

  await save(job);
}

function command(
  commandName,
  args,
) {
  return new Promise(
    (
      resolveCommand,
      reject,
    ) => {
      const child =
        spawn(
          commandName,
          args,
          {
            windowsHide:
              true,
          },
        );

      let output = "";

      child.stdout.on(
        "data",
        (data) => {
          output += data;
        },
      );

      child.stderr.on(
        "data",
        (data) => {
          output += data;
        },
      );

      child.on(
        "error",
        reject,
      );

      child.on(
        "close",
        (code) => {
          if (
            code === 0
          ) {
            resolveCommand(
              output,
            );

            return;
          }

          reject(
            new Error(
              output.trim() ||
                `${commandName} gagal.`,
            ),
          );
        },
      );
    },
  );
}

async function listArchive(
  archivePath,
) {
  try {
    return await command(
      "unzip",
      [
        "-Z1",
        archivePath,
      ],
    );
  } catch {
    return command(
      "tar",
      [
        "-tf",
        archivePath,
      ],
    );
  }
}

async function extractArchive(
  archivePath,
  destination,
) {
  try {
    await command(
      "unzip",
      [
        "-q",
        archivePath,
        "-d",
        destination,
      ],
    );
  } catch {
    await command(
      "tar",
      [
        "-xf",
        archivePath,
        "-C",
        destination,
      ],
    );
  }
}

function safeArchiveList(
  list,
) {
  const entries =
    list
      .split(/\r?\n/)
      .filter(Boolean);

  if (
    !entries.length ||
    entries.length >
      50000
  ) {
    throw new Error(
      "ZIP kosong atau memuat terlalu banyak file.",
    );
  }

  if (
    entries.some(
      (entry) =>
        entry.startsWith(
          "/",
        ) ||
        entry
          .split(
            /[\\/]/,
          )
          .includes(
            "..",
          ),
    )
  ) {
    throw new Error(
      "ZIP memiliki path file yang tidak aman.",
    );
  }

  return entries;
}

async function processArchive(
  job,
) {
  job.status =
    "extracting";

  await log(
    job,
    "info",
    "Arsip diterima executor dan disimpan secara persisten.",
  );

  const archivePath =
    join(
      projectsDir,
      ".nexdeploy",
      "archives",
      `${job.id}-${basename(
        job.payload
          .archiveName,
      )}`,
    );

  const entries =
    safeArchiveList(
      await listArchive(
        archivePath,
      ),
    );

  await log(
    job,
    "success",
    `Validasi aman selesai: ${entries.length} file ditemukan.`,
  );

  const releaseRoot =
    join(
      projectsDir,
      job.payload
        .projectId,
      "releases",
    );

  const extractedRelease =
    join(
      releaseRoot,
      job.id,
    );

  await rm(
    extractedRelease,
    {
      recursive: true,
      force: true,
    },
  );

  await mkdir(
    extractedRelease,
    {
      recursive: true,
    },
  );

  await extractArchive(
    archivePath,
    extractedRelease,
  );

  await log(
    job,
    "success",
    "ZIP berhasil diekstrak ke release baru.",
  );

  const laravelRoot =
    await resolveLaravelReleaseRoot(
      extractedRelease,
    );

  if (!laravelRoot) {
    await log(
      job,
      "warning",
      "Release siap, tetapi root Laravel tidak ditemukan atau ambigu (artisan/composer.json).",
    );

    job.releasePath =
      extractedRelease;

    job.status =
      "waiting_vps";

    job.finishedAt =
      new Date().toISOString();

    await save(job);

    return;
  }

  job.releasePath =
    laravelRoot;

  await save(job);

  if (
    laravelRoot !==
    extractedRelease
  ) {
    await log(
      job,
      "info",
      `Root Laravel ditemukan di folder pembungkus: ${basename(
        laravelRoot,
      )}.`,
    );
  }

  await log(
    job,
    "info",
    "Laravel terdeteksi dan siap diproses runtime.",
  );

  try {
    await deployLaravelRelease(
      job,
      laravelRoot,
    );
  } catch (error) {
    const stage =
      error instanceof
      DeployStageError
        ? error.stage
        : job.status;

    const sanitized =
      error instanceof
      Error
        ? error.message
        : "Deployment Laravel gagal.";

    console.log(
      `DEPLOY_FAILED project=${job.payload.projectId} job=${job.id} state=${stage} error=${JSON.stringify(
        sanitized.slice(
          0,
          300,
        ),
      )}`,
    );

    job.status =
      "failed";

    job.finishedAt =
      new Date().toISOString();

    job.error =
      sanitized;

    await log(
      job,
      "error",
      `Deployment gagal pada tahap ${stage}: ${sanitized}`,
    );
  }
}

async function deployLaravelRelease(
  job,
  release,
) {
  const projectId =
    job.payload
      .projectId;

  console.log(
    `DEPLOY_START project=${projectId} job=${job.id}`,
  );

  const slug =
    safeSlug(
      job.payload
        .projectName ||
        projectId,
    );

  if (!slug) {
    throw new DeployStageError(
      "preparing",
      "Nama project tidak dapat diubah menjadi nama sumber daya Docker yang aman.",
    );
  }

  const shortJobId =
    job.id
      .replace(
        /-/g,
        "",
      )
      .slice(
        0,
        12,
      );

  const network =
    networkName(
      slug,
    );

  const candidateContainer =
    `${containerName(
      slug,
    )}-${shortJobId}`;

  const image =
    imageName(
      slug,
      shortJobId,
    );

  const labels = [
    label(
      PROJECT_LABEL_KEY,
      slug,
    ),
    label(
      JOB_LABEL_KEY,
      job.id,
    ),
  ];

  await transition(
    job,
    "preparing",
    "Menyiapkan release Laravel (database dan environment).",
  );

  const dbConfig = {
    adminDb: process.env.NEXDEPLOY_POSTGRES_DB,
    adminUser: process.env.NEXDEPLOY_POSTGRES_USER,
    adminPass: process.env.NEXDEPLOY_POSTGRES_PASSWORD,
    postgresHost: process.env.NEXDEPLOY_POSTGRES_HOST || "postgres",
    postgresPort: process.env.NEXDEPLOY_POSTGRES_PORT || "5432",
    internalNetwork: process.env.NEXDEPLOY_INTERNAL_NETWORK || "nexdeploy_nexdeploy-internal",
    projectsDir,
    projectsVolume
  };

  if (!dbConfig.adminDb || !dbConfig.adminUser || !dbConfig.adminPass) {
    throw new DeployStageError("preparing", "PostgreSQL admin configuration missing.");
  }

  const dbMetadata = await ensureProjectDatabase(projectId, dbConfig);
  const dbOverrides = {
      DB_CONNECTION: "pgsql",
      DB_HOST: dbMetadata.host,
      DB_PORT: String(dbMetadata.port),
      DB_DATABASE: dbMetadata.database,
      DB_USERNAME: dbMetadata.username,
      DB_PASSWORD: dbMetadata.password
  };

  await prepareLaravelEnvironment(release, dbOverrides);

  await log(
    job,
    "info",
    "Menghapus cache package Laravel lama.",
  );

  await clearLaravelBootstrapCache(release);

  if (
    await shouldRunComposer(
      release,
    )
  ) {
    await log(
      job,
      "info",
      "Menjalankan composer install (--no-dev).",
    );

    try {
      await runOneShot({
        image:
          "nexdeploy/laravel-runtime:php-8.4",
        command:
          composerInstallCommand(),

        volumes: [
          `${projectsVolume}:${projectsDir}`,
        ],

        workdir:
          release,

        labels,
      });
    } catch (error) {
      throw new DeployStageError(
        "preparing",
        `Composer install gagal: ${summarizeFailure(
          error?.message,
        )}`,
      );
    }

    await log(
      job,
      "success",
      "Composer install selesai.",
    );

    await log(
      job,
      "info",
      "Membangun ulang Laravel package discovery manifest.",
    );

    await clearLaravelBootstrapCache(release);

    try {
      await runOneShot({
        image: "nexdeploy/laravel-runtime:php-8.4",
        command: packageDiscoverCommand(),
        volumes: [
          `${projectsVolume}:${projectsDir}`,
        ],
        workdir: release,
        labels,
      });
    } catch (error) {
      throw new DeployStageError(
        "preparing",
        `Laravel package discovery gagal: ${summarizeFailure(error?.message)}`,
      );
    }

    await log(
      job,
      "info",
      "Menjalankan migrasi database Laravel.",
    );

    try {
      await runOneShot({
        image: "nexdeploy/laravel-runtime:php-8.4",
        network: process.env.NEXDEPLOY_INTERNAL_NETWORK || "nexdeploy_nexdeploy-internal",
        workdir: release,
        volumes: [`${projectsVolume}:${projectsDir}`],
        command: ["php", "artisan", "migrate", "--force"],
      });
      await log(job, "success", "Migrasi database Laravel selesai.");
    } catch (e) {
      throw new DeployStageError("preparing", summarizeFailure(e));
    }

    await log(
      job,
      "success",
      "Laravel package discovery manifest berhasil dibangun ulang.",
    );
  }

  await transition(
    job,
    "building",
    "Membangun frontend (jika ada) dan image Docker.",
  );

  if (
    await shouldRunFrontendBuild(
      release,
    )
  ) {
    await log(
      job,
      "info",
      "package.json ditemukan, menjalankan frontend build.",
    );

    try {
      await runOneShot({
        image:
          "node:22-alpine",

        command:
          frontendBuildCommand(),

        volumes: [
          `${projectsVolume}:${projectsDir}`,
        ],

        workdir:
          release,

        labels,
      });
    } catch (error) {
      throw new DeployStageError(
        "building",
        `Build frontend gagal: ${summarizeFailure(
          error?.message,
        )}`,
      );
    }

    await log(
      job,
      "success",
      "Build frontend selesai.",
    );
  } else {
    await log(
      job,
      "info",
      "package.json tidak ditemukan, melewati build frontend.",
    );
  }

  try {
    await buildImage({
      dockerfile:
        laravelDockerfile,

      context:
        release,

      tag:
        image,

      labels,
    });
  } catch (error) {
    throw new DeployStageError(
      "building",
      `Build image Docker gagal: ${summarizeFailure(
        error?.message,
      )}`,
    );
  }

  await log(
    job,
    "success",
    `Image ${image} berhasil dibuild.`,
  );

  await transition(
    job,
    "starting",
    "Menjalankan kontainer aplikasi.",
  );

  const existingContainers = await listContainersByLabel(
    label(PROJECT_LABEL_KEY, slug),
  );

  const stablePortPath = join(
    projectsDir,
    projectId,
    ".nexdeploy-stable-port",
  );

  let stableHostPort = null;

  try {
    stableHostPort = Number(
      (await readFile(stablePortPath, "utf8")).trim(),
    );

    if (
      !Number.isInteger(stableHostPort) ||
      stableHostPort < 1 ||
      stableHostPort > 65535
    ) {
      stableHostPort = null;
    }
  } catch {
    stableHostPort = null;
  }

  if (
    !stableHostPort &&
    existingContainers.length > 0
  ) {
    stableHostPort = await getContainerHostPort(
      existingContainers[0],
      CONTAINER_PORT,
    );
  }

  if (!stableHostPort) {
    stableHostPort = await allocateHostPort();
  }

  await writeFile(
    stablePortPath,
    String(stableHostPort),
    "utf8",
  );

  let candidateHostPort = stableHostPort;

  if (existingContainers.length > 0) {
    candidateHostPort = await allocateHostPort();
  }

  let hostPort = candidateHostPort;

  try {
    await ensureNetwork(
      network,
      labels,
    );

    await startContainer({
      name:
        candidateContainer,

      image,

      network,
      additionalNetworks: [process.env.NEXDEPLOY_INTERNAL_NETWORK || "nexdeploy_nexdeploy-internal"],

      hostPort,

      containerPort:
        CONTAINER_PORT,

      envFile:
        join(
          release,
          ".env",
        ),

      labels,

      command:
        buildEntrypointCommand(),
    });
  } catch (error) {
    throw new DeployStageError(
      "starting",
      `Menjalankan kontainer gagal: ${summarizeFailure(
        error?.message,
      )}`,
    );
  }

  job.containerName =
    candidateContainer;

  job.imageName =
    image;

  job.networkName =
    network;

  job.hostPort =
    hostPort;

  await save(job);

  await log(
    job,
    "success",
    `Kontainer ${candidateContainer} berjalan pada host port ${hostPort}.`,
  );

  await transition(
    job,
    "health_check",
    `Memeriksa kesehatan HTTP pada port ${hostPort}.`,
  );

  const healthy =
    await waitForHealthy(
      candidateContainer,
      CONTAINER_PORT,
    );

  if (!healthy) {
    const diagnostics =
      await diagnoseContainer(
        candidateContainer,
      );

    await removeContainerIfExists(
      candidateContainer,
    ).catch(
      () => {},
    );

    throw new DeployStageError(
      "health_check",
      `Aplikasi tidak merespons HTTP dalam waktu yang ditentukan.${
        diagnostics
          ? ` Log terakhir: ${summarizeFailure(
              diagnostics,
            )}`
          : ""
      }`,
    );
  }

  await log(
    job,
    "success",
    "Health check HTTP berhasil.",
  );

  // Candidate sudah sehat. Lakukan cutover ke stable port project.
  if (candidateHostPort !== stableHostPort) {
    await log(
      job,
      "info",
      `Candidate sehat. Melakukan cutover dari temporary port ${candidateHostPort} ke stable port ${stableHostPort}.`,
    );

    try {
      // Hapus seluruh container lama project kecuali candidate.
      for (const name of existingContainers) {
        if (name !== candidateContainer) {
          await removeContainerIfExists(name);
        }
      }

      // Candidate temporary harus dilepas agar image yang sama dapat
      // dijalankan ulang menggunakan stable host port.
      await removeContainerIfExists(candidateContainer);

      await startContainer({
        name: candidateContainer,
        image,
        network,
        additionalNetworks: [process.env.NEXDEPLOY_INTERNAL_NETWORK || "nexdeploy_nexdeploy-internal"],
        hostPort: stableHostPort,
        containerPort: CONTAINER_PORT,
        envFile: join(release, ".env"),
        labels,
        command: buildEntrypointCommand(),
      });

      const finalHealthy = await waitForHealthy(
        candidateContainer,
        CONTAINER_PORT,
      );

      if (!finalHealthy) {
        const diagnostics = await diagnoseContainer(
          candidateContainer,
        );

        await removeContainerIfExists(
          candidateContainer,
        ).catch(() => {});

        throw new DeployStageError(
          "health_check",
          `Final container pada stable port ${stableHostPort} gagal health check.${
            diagnostics
              ? ` Log terakhir: ${summarizeFailure(diagnostics)}`
              : ""
          }`,
        );
      }

      hostPort = stableHostPort;

      await log(
        job,
        "success",
        `Release baru aktif pada stable host port ${stableHostPort}.`,
      );
    } catch (error) {
      if (error instanceof DeployStageError) {
        throw error;
      }

      throw new DeployStageError(
        "starting",
        `Cutover ke stable port gagal: ${summarizeFailure(error?.message)}`,
      );
    }
  } else {
    // Deployment pertama atau stable port sedang tidak dipakai.
    // Bersihkan container project lama bila masih ada.
    try {
      for (const name of existingContainers) {
        if (name !== candidateContainer) {
          await removeContainerIfExists(name);
        }
      }
    } catch {
      // Best effort cleanup.
    }

    hostPort = stableHostPort;
  }

  job.hostPort = stableHostPort;
  job.status =
    "running";

  job.startedAt =
    job.startedAt ||
    new Date().toISOString();

  job.finishedAt =
    new Date().toISOString();

  await log(
    job,
    "success",
    "Aplikasi Laravel berhasil dijalankan.",
  );

  await save(job);

  console.log(
    `DEPLOY_SUCCESS project=${projectId} job=${job.id} port=${hostPort}`,
  );
}

async function transition(
  job,
  status,
  message,
) {
  job.status =
    status;

  await log(
    job,
    "info",
    message,
  );

  console.log(
    `DEPLOY_STEP project=${job.payload.projectId} job=${job.id} state=${status}`,
  );
}

async function prepareLaravelEnvironment(
  release,
  overrides = {},
) {
  const envPath =
    join(
      release,
      ".env",
    );

  const examplePath =
    join(
      release,
      ".env.example",
    );

  const dockerignorePath =
    join(
      release,
      ".dockerignore",
    );

  let base = "";

  try {
    base =
      await readFile(
        envPath,
        "utf8",
      );
  } catch {
    try {
      base =
        await readFile(
          examplePath,
          "utf8",
        );
    } catch {
      base =
        "";
    }
  }

  const merged =
    mergeEnvFile(
      base,
      ({ ...buildRuntimeEnvironment(), ...overrides }),
    );

  await writeFile(
    envPath,
    merged,
    "utf8",
  );

  

  // Jangan pernah bake file yang tidak diperlukan ke Docker image.

let dockerignore = "";

try {
  dockerignore =
    await readFile(
      dockerignorePath,
      "utf8",
    );
} catch {
  dockerignore =
    "";
}

const existingDockerignore =
  dockerignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

const requiredDockerignore = [
  ".env",
  "node_modules",
  ".git",
  ".github",
  "tests",
  "storage/logs/*",
  "npm-debug.log*",
  "yarn-error.log*",
];

const nextDockerignore = [
  ...new Set([
    ...existingDockerignore,
    ...requiredDockerignore,
  ]),
].join("\n") + "\n";

await writeFile(
  dockerignorePath,
  nextDockerignore,
  "utf8",
);

  for (
    const dir of [
      "storage",
      join(
        "bootstrap",
        "cache",
      ),
    ]
  ) {
    try {
      await chmod(
        join(
          release,
          dir,
        ),
        0o775,
      );
    } catch {
      // Best effort.
    }
  }
}

async function waitForHealthy(
  container,
  containerPort,
  {
    totalMs = 60000,
    intervalMs = 3000,
  } = {},
) {
  const deadline =
    Date.now() + totalMs;

  while (
    Date.now() < deadline
  ) {
    if (
      await containerHttpHealthy(
        container,
        containerPort,
      )
    ) {
      return true;
    }

    await new Promise(
      (resolveWait) =>
        setTimeout(
          resolveWait,
          intervalMs,
        ),
    );
  }

  return false;
}



const server =
  createServer(
    async (
      request,
      response,
    ) => {
      try {
        const url =
          new URL(
            request.url,
            `http://${request.headers.host}`,
          );

        if (
          request.method ===
            "GET" &&
          url.pathname ===
            "/health"
        ) {
          const supplied =
            request.headers
              .authorization;

          if (
            supplied &&
            !authorized(
              request,
            )
          ) {
            return json(
              response,
              401,
              {
                error:
                  "Token executor tidak valid.",
              },
            );
          }

          let workspace =
            "ready";

          try {
            await access(
              projectsDir,
            );
          } catch {
            workspace =
              "will-create";
          }

          return json(
            response,
            200,
            {
              ok:
                true,

              version:
                "0.3.0",

              mode:
                "local",

              services: {
                executor:
                  "ready",

                workspace,

                docker:
                  "cli-passthrough",

                database:
                  "not-configured",

                npm:
                  "not-configured",
              },
            },
          );
        }

        if (
          !authorized(
            request,
          )
        ) {
          return json(
            response,
            401,
            {
              error:
                "Token executor tidak valid.",
            },
          );
        }

        if (
          request.method ===
            "POST" &&
          url.pathname ===
            "/jobs/deploy"
        ) {
          const payload =
            await body(
              request,
            );

          if (
            !payload.projectId ||
            !payload.archiveName
          ) {
            return json(
              response,
              400,
              {
                error:
                  "projectId dan archiveName wajib diisi.",
              },
            );
          }

          const job = {
            id:
              randomUUID(),

            type:
              "deploy",

            status:
              "awaiting_archive",

            payload,

            createdAt:
              new Date().toISOString(),

            logs:
              [],
          };

          jobs.set(
            job.id,
            job,
          );

          await log(
            job,
            "info",
            "Job disimpan dan menunggu arsip ZIP dari panel.",
          );

          return json(
            response,
            202,
            {
              job: {
                id:
                  job.id,

                status:
                  job.status,
              },
            },
          );
        }

        const archiveMatch =
          url.pathname.match(
            /^\/jobs\/([^/]+)\/archive$/,
          );

        if (
          request.method ===
            "PUT" &&
          archiveMatch
        ) {
          const job =
            await load(
              archiveMatch[1],
            );

          if (!job) {
            return json(
              response,
              404,
              {
                error:
                  "Job tidak ditemukan.",
              },
            );
          }

          if (
            job.status !==
            "awaiting_archive"
          ) {
            return json(
              response,
              409,
              {
                error:
                  "Arsip sudah diterima untuk job ini.",
              },
            );
          }

          const chunks =
            [];

          let bytes =
            0;

          for await (
            const chunk of request
          ) {
            bytes +=
              chunk.length;

            if (
              bytes >
              100 *
                1024 *
                1024
            ) {
              return json(
                response,
                413,
                {
                  error:
                    "Arsip maksimal 100 MB.",
                },
              );
            }

            chunks.push(
              chunk,
            );
          }

          const archiveDir =
            join(
              projectsDir,
              ".nexdeploy",
              "archives",
            );

          await mkdir(
            archiveDir,
            {
              recursive:
                true,
            },
          );

          await writeFile(
            join(
              archiveDir,
              `${job.id}-${basename(
                job.payload
                  .archiveName,
              )}`,
            ),

            Buffer.concat(
              chunks,
            ),
          );

          void processArchive(
            job,
          ).catch(
            async (
              error,
            ) => {
              const message =
                error instanceof
                Error
                  ? error.message
                  : "Ekstraksi ZIP gagal.";

              job.status =
                "failed";

              job.finishedAt =
                new Date().toISOString();

              job.error =
                message;

              await log(
                job,
                "error",
                message,
              );
            },
          );

          return json(
            response,
            202,
            {
              ok:
                true,
            },
          );
        }

        const match =
          url.pathname.match(
            /^\/jobs\/([^/]+)(\/logs)?$/,
          );

        if (
          request.method ===
            "GET" &&
          match
        ) {
          const job =
            await load(
              match[1],
            );

          if (!job) {
            return json(
              response,
              404,
              {
                error:
                  "Job tidak ditemukan.",
              },
            );
          }

          return json(
            response,
            200,
            match[2]
              ? {
                  logs:
                    job.logs,
                }
              : {
                  job: {
                    ...job,

                    logs:
                      undefined,
                  },
                },
          );
        }

        return json(
          response,
          404,
          {
            error:
              "Endpoint tidak ditemukan.",
          },
        );
      } catch (error) {
        return json(
          response,
          500,
          {
            error:
              error instanceof
              Error
                ? error.message
                : "Executor gagal memproses permintaan.",
          },
        );
      }
    },
  );

server.listen(
  port,
  host,
  () => {
    console.log(
      `NEXDEPLOY executor aktif di http://${host}:${port}`,
    );
  },
);
