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
  statfs,
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
  startBackgroundContainer,
  buildImage,
  runOneShot,
  listContainersByLabel,
  removeContainerIfExists,
  removeImagesByLabel,
  removeNetwork,
  diagnoseContainer,
  containerHttpHealthy,
  getContainerHostPort,
  containerRunning,
  containerStats,
  stopContainer,
  startExistingContainer,
} from "./deployment/docker.mjs";

import {
  loadProjectEnvironment,
  saveProjectEnvironment,
} from "./deployment/environment.mjs";

import {
  sanitizeLogMessage,
} from "./deployment/logs.mjs";
import {
  ensureProjectDatabase,
  backupProjectDatabase,
  restoreProjectDatabase,
  dropProjectDatabase,
  loadProjectDatabaseMetadata,
} from "./deployment/postgres.mjs";

import {
  ensureMariaDbProjectDatabase,
  backupMariaDbProjectDatabase,
  restoreMariaDbProjectDatabase,
  dropMariaDbProjectDatabase,
  loadMariaDbMetadata,
} from "./deployment/mariadb.mjs";

import {
  resolveLaravelReleaseRoot,
  shouldRunComposer,
  shouldRunFrontendBuild,
  composerInstallCommand,
  frontendBuildCommand,
  buildEntrypointCommand,
  buildQueueWorkerCommand,
  buildSchedulerCommand,
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
    message:
      sanitizeLogMessage(message),
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
      sanitizeLogMessage(
        error instanceof
        Error
          ? error.message
          : "Deployment Laravel gagal.",
      );

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
      `[FAILURE] Deployment gagal pada tahap ${stage}: ${sanitized}`,
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

    const databaseType =
      job.payload.databaseType ||
      "PostgreSQL";

    let dbConfig = null;
    let dbMetadata = null;
    let dbOverrides = {};

    if (
      databaseType ===
      "PostgreSQL"
    ) {
      dbConfig = {
        adminDb:
          process.env.NEXDEPLOY_POSTGRES_DB,
        adminUser:
          process.env.NEXDEPLOY_POSTGRES_USER,
        adminPass:
          process.env.NEXDEPLOY_POSTGRES_PASSWORD,
        postgresHost:
          process.env.NEXDEPLOY_POSTGRES_HOST ||
          "postgres",
        postgresPort:
          process.env.NEXDEPLOY_POSTGRES_PORT ||
          "5432",
        internalNetwork:
          process.env.NEXDEPLOY_INTERNAL_NETWORK ||
          "nexdeploy_nexdeploy-internal",
        projectsDir,
        projectsVolume,
      };

      if (
        !dbConfig.adminDb ||
        !dbConfig.adminUser ||
        !dbConfig.adminPass
      ) {
        throw new DeployStageError(
          "preparing",
          "PostgreSQL admin configuration missing.",
        );
      }

      dbMetadata =
        await ensureProjectDatabase(
          projectId,
          dbConfig,
        );

      dbOverrides = {
        DB_CONNECTION:
          "pgsql",
        DB_HOST:
          dbMetadata.host,
        DB_PORT:
          String(
            dbMetadata.port,
          ),
        DB_DATABASE:
          dbMetadata.database,
        DB_USERNAME:
          dbMetadata.username,
        DB_PASSWORD:
          dbMetadata.password,
      };

      await log(
        job,
        "success",
        `[DATABASE] PostgreSQL project siap: ${dbMetadata.database}.`,
      );
    } else if (
      databaseType ===
      "MariaDB"
    ) {
      dbConfig = {
        mariadbHost:
          process.env.NEXDEPLOY_MARIADB_HOST ||
          "mariadb",
        mariadbPort:
          process.env.NEXDEPLOY_MARIADB_PORT ||
          "3306",
        rootPassword:
          process.env.NEXDEPLOY_MARIADB_ROOT_PASSWORD,
        internalNetwork:
          process.env.NEXDEPLOY_INTERNAL_NETWORK ||
          "nexdeploy_nexdeploy-internal",
        projectsDir,
        projectsVolume,
      };

      if (
        !dbConfig.rootPassword
      ) {
        throw new DeployStageError(
          "preparing",
          "MariaDB admin configuration missing.",
        );
      }

      dbMetadata =
        await ensureMariaDbProjectDatabase(
          projectId,
          dbConfig,
        );

      dbOverrides = {
        DB_CONNECTION:
          "mysql",
        DB_HOST:
          dbMetadata.host,
        DB_PORT:
          String(
            dbMetadata.port,
          ),
        DB_DATABASE:
          dbMetadata.database,
        DB_USERNAME:
          dbMetadata.username,
        DB_PASSWORD:
          dbMetadata.password,
      };

      await log(
        job,
        "success",
        `[DATABASE] MariaDB project siap: ${dbMetadata.database}.`,
      );
    } else if (
      databaseType ===
      "Tanpa database"
    ) {
      await log(
        job,
        "info",
        "[DATABASE] Project dikonfigurasi tanpa database; provisioning dilewati.",
      );
    } else {
      throw new DeployStageError(
        "preparing",
        `Database type tidak didukung: ${databaseType}.`,
      );
    }

    const userEnvironment =
      await loadProjectEnvironment(
        projectsDir,
        projectId,
      );

    await log(
      job,
      "info",
      `[ENVIRONMENT] ${Object.keys(userEnvironment).length} variable environment project dimuat.`,
    );

  await prepareLaravelEnvironment(
    release,
    {
      ...userEnvironment,
      ...dbOverrides,
    },
  );

  await log(
    job,
    "success",
    "[ENVIRONMENT] Runtime environment Laravel berhasil disiapkan.",
  );

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
      "[COMPOSER] Menjalankan composer install (--no-dev).",
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
      "[COMPOSER] Composer install selesai.",
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

      if (
        databaseType ===
        "PostgreSQL"
      ) {
        await log(
          job,
          "info",
          "[BACKUP] Membuat backup PostgreSQL sebelum migrasi.",
        );

        try {
          const databaseBackup =
            await backupProjectDatabase(
              projectId,
              dbMetadata,
              dbConfig,
              {
                retention: 10,
              },
            );

          await log(
            job,
            "success",
            `[BACKUP] Backup PostgreSQL selesai: ${databaseBackup.fileName}`,
          );
        } catch (error) {
          throw new DeployStageError(
            "preparing",
            `Backup PostgreSQL gagal: ${summarizeFailure(
              error?.message,
            )}`,
          );
        }
      } else if (
        databaseType ===
        "MariaDB"
      ) {
        await log(
          job,
          "info",
          "[BACKUP] Membuat backup MariaDB sebelum migrasi.",
        );

        try {
          const databaseBackup =
            await backupMariaDbProjectDatabase(
              projectId,
              dbMetadata,
              dbConfig,
              {
                retention: 10,
              },
            );

          await log(
            job,
            "success",
            `[BACKUP] Backup MariaDB selesai: ${databaseBackup.fileName}`,
          );
        } catch (error) {
          throw new DeployStageError(
            "preparing",
            `Backup MariaDB gagal: ${summarizeFailure(
              error?.message,
            )}`,
          );
        }
      } else {
        await log(
          job,
          "info",
          "[BACKUP] Project tanpa database; backup dilewati.",
        );
      }

      if (
        databaseType !==
        "Tanpa database"
      ) {
        await log(
          job,
          "info",
          "[MIGRATION] Menjalankan migrasi database Laravel.",
        );

        try {
          await runOneShot({
            image:
              "nexdeploy/laravel-runtime:php-8.4",
            network:
              process.env.NEXDEPLOY_INTERNAL_NETWORK ||
              "nexdeploy_nexdeploy-internal",
            workdir:
              release,
            volumes: [
              `${projectsVolume}:${projectsDir}`,
            ],
            command: [
              "php",
              "artisan",
              "migrate",
              "--force",
            ],
          });

          await log(
            job,
            "success",
            "[MIGRATION] Migrasi database Laravel selesai.",
          );
        } catch (error) {
          throw new DeployStageError(
            "preparing",
            `Migrasi database Laravel gagal: ${summarizeFailure(
              error?.message,
            )}`,
          );
        }
      } else {
        await log(
          job,
          "info",
          "[MIGRATION] Project tanpa database; migrasi dilewati.",
        );
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
      "[FRONTEND] package.json ditemukan, menjalankan frontend build.",
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
      "[FRONTEND] Build frontend selesai.",
    );
  } else {
    await log(
      job,
      "info",
      "[FRONTEND] package.json tidak ditemukan, melewati build frontend.",
    );
  }

  await log(
    job,
    "info",
    `[IMAGE] Membangun Docker image ${image}.`,
  );

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
    `[IMAGE] Image ${image} berhasil dibuild.`,
  );

  await transition(
    job,
    "starting",
    "Menjalankan kontainer aplikasi.",
  );

  const projectContainers =
    await listContainersByLabel(
      label(
        PROJECT_LABEL_KEY,
        slug,
      ),
    );

  const appContainerPrefix =
    `nexdeploy-${slug}-app-`;

  const existingContainers =
    projectContainers.filter(
      (name) =>
        name.startsWith(
          appContainerPrefix,
        ),
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

  await log(
    job,
    "info",
    `[CANDIDATE] Menjalankan candidate container pada host port ${candidateHostPort}.`,
  );

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
    "[HEALTHCHECK] Health check HTTP berhasil.",
  );

  // Candidate sudah sehat. Lakukan cutover ke stable port project.
  if (candidateHostPort !== stableHostPort) {
    await log(
      job,
      "info",
      `[CUTOVER] Candidate sehat. Melakukan cutover dari temporary port ${candidateHostPort} ke stable port ${stableHostPort}.`,
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

      await log(
        job,
        "info",
        `[HEALTHCHECK] Memverifikasi release pada stable port ${stableHostPort}.`,
      );

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
        `[CUTOVER] Release baru aktif pada stable host port ${stableHostPort}.`,
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

  const workerContainer =
    `nexdeploy-${slug}-worker`;

  const schedulerContainer =
    `nexdeploy-${slug}-scheduler`;

  const runtimeNetworks = [
    process.env.NEXDEPLOY_INTERNAL_NETWORK ||
      "nexdeploy_nexdeploy-internal",
  ];

  try {
    await log(
      job,
      "info",
      "[WORKER] Menjalankan Laravel queue worker.",
    );

    await startBackgroundContainer({
      name:
        workerContainer,

      image,

      network,

      additionalNetworks:
        runtimeNetworks,

      envFile:
        join(
          release,
          ".env",
        ),

      labels,

      command:
        buildQueueWorkerCommand(),
    });

    await log(
      job,
      "success",
      `[WORKER] Queue worker aktif: ${workerContainer}.`,
    );

    await log(
      job,
      "info",
      "[SCHEDULER] Menjalankan Laravel scheduler.",
    );

    await startBackgroundContainer({
      name:
        schedulerContainer,

      image,

      network,

      additionalNetworks:
        runtimeNetworks,

      envFile:
        join(
          release,
          ".env",
        ),

      labels,

      command:
        buildSchedulerCommand(),
    });

    await log(
      job,
      "success",
      `[SCHEDULER] Scheduler aktif: ${schedulerContainer}.`,
    );
  } catch (error) {
    await removeContainerIfExists(
      workerContainer,
    ).catch(
      () => {},
    );

    await removeContainerIfExists(
      schedulerContainer,
    ).catch(
      () => {},
    );

    throw new DeployStageError(
      "starting",
      `Laravel runtime services gagal dijalankan: ${summarizeFailure(
        error?.message,
      )}`,
    );
  }

  await log(
    job,
    "success",
    `Laravel runtime services aktif: ${workerContainer}, ${schedulerContainer}.`,
  );
  job.hostPort = stableHostPort;

  job.startedAt =
    job.startedAt ||
    new Date().toISOString();

  await log(
    job,
    "success",
    `[SUCCESS] Deployment Laravel selesai. Release aktif pada stable host port ${stableHostPort}.`,
  );

  job.status =
    "succeeded";

  job.finishedAt =
    new Date().toISOString();

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




async function createManualDatabaseBackup({
  projectId,
  databaseType,
  retention = 7,
}) {
  if (
    !Number.isInteger(retention) ||
    retention < 1 ||
    retention > 100
  ) {
    throw new Error(
      "Retention backup harus antara 1 sampai 100.",
    );
  }

  const projectsDir =
    process.env.PROJECTS_DIR ||
    "/opt/nexdeploy/projects";

  const projectsVolume =
    process.env.PROJECTS_VOLUME ||
    "nexdeploy_executor-projects";

  const internalNetwork =
    process.env.NEXDEPLOY_INTERNAL_NETWORK ||
    "nexdeploy_nexdeploy-internal";

  if (databaseType === "PostgreSQL") {
    const config = {
      projectsDir,
      projectsVolume,
      internalNetwork,
      postgresHost:
        process.env.NEXDEPLOY_POSTGRES_HOST ||
        "postgres",
      postgresPort:
        process.env.NEXDEPLOY_POSTGRES_PORT ||
        "5432",
    };

    const metadata =
      await loadProjectDatabaseMetadata(
        projectsDir,
        projectId,
      );

    if (!metadata) {
      throw new Error(
        "Metadata PostgreSQL project belum tersedia. Deploy project terlebih dahulu.",
      );
    }

    return {
      databaseType,
      ...await backupProjectDatabase(
        projectId,
        metadata,
        config,
        {
          retention,
        },
      ),
    };
  }

  if (databaseType === "MariaDB") {
    const config = {
      projectsDir,
      projectsVolume,
      internalNetwork,
      mariadbHost:
        process.env.NEXDEPLOY_MARIADB_HOST ||
        "mariadb",
      mariadbPort:
        process.env.NEXDEPLOY_MARIADB_PORT ||
        "3306",
    };

    const metadata =
      await loadMariaDbMetadata(
        projectsDir,
        projectId,
      );

    if (!metadata) {
      throw new Error(
        "Metadata MariaDB project belum tersedia. Deploy project terlebih dahulu.",
      );
    }

    return {
      databaseType,
      ...await backupMariaDbProjectDatabase(
        projectId,
        metadata,
        config,
        {
          retention,
        },
      ),
    };
  }

  throw new Error(
    `Database type tidak didukung: ${databaseType}.`,
  );
}




async function testDatabaseConnection({
  projectId,
  databaseType,
}) {
  const projectsDir =
    process.env.PROJECTS_DIR ||
    "/opt/nexdeploy/projects";

  const internalNetwork =
    process.env.NEXDEPLOY_INTERNAL_NETWORK ||
    "nexdeploy_nexdeploy-internal";

  if (databaseType === "PostgreSQL") {
    const metadata =
      await loadProjectDatabaseMetadata(
        projectsDir,
        projectId,
      );

    if (!metadata) {
      throw new Error(
        "Metadata PostgreSQL project belum tersedia. Deploy project terlebih dahulu.",
      );
    }

    const startedAt =
      performance.now();

    await runOneShot({
      image:
        "postgres:17-alpine",
      network:
        internalNetwork,

      env: {
        PGHOST:
          metadata.host,
        PGPORT:
          String(metadata.port),
        PGDATABASE:
          metadata.database,
        PGUSER:
          metadata.username,
        PGPASSWORD:
          metadata.password,
      },

      command: [
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-tAc",
        "SELECT 1;",
      ],
    });

    const latencyMs =
      Math.max(
        0,
        Math.round(
          performance.now() -
            startedAt,
        ),
      );

    return {
      databaseType,
      database:
        metadata.database,
      host:
        metadata.host,
      port:
        Number(
          metadata.port,
        ),
      latencyMs,
    };
  }

  if (databaseType === "MariaDB") {
    const metadata =
      await loadMariaDbMetadata(
        projectsDir,
        projectId,
      );

    if (!metadata) {
      throw new Error(
        "Metadata MariaDB project belum tersedia. Deploy project terlebih dahulu.",
      );
    }

    const startedAt =
      performance.now();

    await runOneShot({
      image:
        "mariadb:11.4",
      network:
        internalNetwork,

      env: {
        MYSQL_PWD:
          metadata.password,
      },

      command: [
        "mariadb",
        "-h",
        metadata.host,
        "-P",
        String(
          metadata.port,
        ),
        "-u",
        metadata.username,
        "-D",
        metadata.database,
        "-Nse",
        "SELECT 1;",
      ],
    });

    const latencyMs =
      Math.max(
        0,
        Math.round(
          performance.now() -
            startedAt,
        ),
      );

    return {
      databaseType,
      database:
        metadata.database,
      host:
        metadata.host,
      port:
        Number(
          metadata.port,
        ),
      latencyMs,
    };
  }

  throw new Error(
    `Database type tidak didukung: ${databaseType}.`,
  );
}


async function restoreManualDatabaseBackup({
  projectId,
  databaseType,
  backupFileName,
}) {
  if (
    typeof backupFileName !== "string" ||
    !backupFileName.trim()
  ) {
    throw new Error(
      "Nama file backup untuk restore wajib diisi.",
    );
  }

  const projectsDir =
    process.env.PROJECTS_DIR ||
    "/opt/nexdeploy/projects";

  const projectsVolume =
    process.env.PROJECTS_VOLUME ||
    "nexdeploy_executor-projects";

  const internalNetwork =
    process.env.NEXDEPLOY_INTERNAL_NETWORK ||
    "nexdeploy_nexdeploy-internal";

  if (databaseType === "PostgreSQL") {
    const config = {
      projectsDir,
      projectsVolume,
      internalNetwork,

      postgresHost:
        process.env.NEXDEPLOY_POSTGRES_HOST ||
        "postgres",

      postgresPort:
        process.env.NEXDEPLOY_POSTGRES_PORT ||
        "5432",

      adminDb:
        process.env.NEXDEPLOY_POSTGRES_DB ||
        "postgres",

      adminUser:
        process.env.NEXDEPLOY_POSTGRES_USER,

      adminPass:
        process.env.NEXDEPLOY_POSTGRES_PASSWORD,
    };

    const metadata =
      await loadProjectDatabaseMetadata(
        projectsDir,
        projectId,
      );

    if (!metadata) {
      throw new Error(
        "Metadata PostgreSQL project belum tersedia. Deploy project terlebih dahulu.",
      );
    }

    return {
      databaseType,

      ...await restoreProjectDatabase(
        projectId,
        metadata,
        backupFileName,
        config,
      ),
    };
  }

  if (databaseType === "MariaDB") {
    const config = {
      projectsDir,
      projectsVolume,
      internalNetwork,

      mariadbHost:
        process.env.NEXDEPLOY_MARIADB_HOST ||
        "mariadb",

      mariadbPort:
        process.env.NEXDEPLOY_MARIADB_PORT ||
        "3306",

      rootPassword:
        process.env.NEXDEPLOY_MARIADB_ROOT_PASSWORD,
    };

    const metadata =
      await loadMariaDbMetadata(
        projectsDir,
        projectId,
      );

    if (!metadata) {
      throw new Error(
        "Metadata MariaDB project belum tersedia. Deploy project terlebih dahulu.",
      );
    }

    return {
      databaseType,

      ...await restoreMariaDbProjectDatabase(
        projectId,
        metadata,
        backupFileName,
        config,
      ),
    };
  }

  throw new Error(
    `Database type restore tidak didukung: ${databaseType}.`,
  );
}


async function permanentlyCleanupProject(
  payload,
) {
  const {
    projectId,
    projectName,
    databaseType,
  } = payload;

  if (
    typeof projectId !== "string" ||
    !/^[0-9a-fA-F-]{36}$/.test(projectId)
  ) {
    throw new Error(
      "projectId tidak valid.",
    );
  }

  const slug =
    safeSlug(
      projectName,
    );

  if (!slug) {
    throw new Error(
      "Nama project tidak dapat diubah menjadi slug yang aman.",
    );
  }

  const projectLabel =
    label(
      PROJECT_LABEL_KEY,
      slug,
    );

  const report = {
    projectId,
    slug,
    containers: [],
    images: [],
    network:
      null,
    database:
      null,
    projectDirectory:
      false,
  };

  // 1. Semua container project berdasarkan label.
  const containers =
    await listContainersByLabel(
      projectLabel,
    );

  for (const name of containers) {
    await removeContainerIfExists(
      name,
    );

    report.containers.push(
      name,
    );
  }

  // Defensive cleanup untuk worker/scheduler lama.
  for (
    const name
    of [
      `nexdeploy-${slug}-worker`,
      `nexdeploy-${slug}-scheduler`,
    ]
  ) {
    await removeContainerIfExists(
      name,
    );
  }

  // 2. Database project.
  const commonDbConfig = {
    internalNetwork:
      process.env.NEXDEPLOY_INTERNAL_NETWORK ||
      "nexdeploy_nexdeploy-internal",
    projectsDir,
    projectsVolume,
  };

  if (
    databaseType ===
    "PostgreSQL"
  ) {
    report.database =
      await dropProjectDatabase(
        projectId,
        {
          ...commonDbConfig,
          adminDb:
            process.env.NEXDEPLOY_POSTGRES_DB,
          adminUser:
            process.env.NEXDEPLOY_POSTGRES_USER,
          adminPass:
            process.env.NEXDEPLOY_POSTGRES_PASSWORD,
          postgresHost:
            process.env.NEXDEPLOY_POSTGRES_HOST ||
            "postgres",
          postgresPort:
            process.env.NEXDEPLOY_POSTGRES_PORT ||
            "5432",
        },
      );
  } else if (
    databaseType ===
    "MariaDB"
  ) {
    report.database =
      await dropMariaDbProjectDatabase(
        projectId,
        {
          ...commonDbConfig,
          mariadbHost:
            process.env.NEXDEPLOY_MARIADB_HOST ||
            "mariadb",
          mariadbPort:
            process.env.NEXDEPLOY_MARIADB_PORT ||
            "3306",
          rootPassword:
            process.env.NEXDEPLOY_MARIADB_ROOT_PASSWORD,
        },
      );
  } else if (
    databaseType !==
    "Tanpa database"
  ) {
    throw new Error(
      `Database type tidak didukung: ${databaseType}.`,
    );
  }

  // 3. Network setelah semua container sudah dilepas.
  const projectNetwork =
    networkName(
      slug,
    );

  await removeNetwork(
    projectNetwork,
  );

  report.network =
    projectNetwork;

  // 4. Semua Docker image project berdasarkan label.
  report.images =
    await removeImagesByLabel(
      projectLabel,
    );

  // 5. Folder project terakhir.
  // Ini sekaligus membuang release, backup DB,
  // metadata DB, dan .nexdeploy-stable-port.
  await rm(
    join(
      projectsDir,
      projectId,
    ),
    {
      recursive: true,
      force: true,
    },
  );

  report.projectDirectory =
    true;

  return report;
}



const hostProcDir =
  "/host/proc";

const hostRootDir =
  "/host/root";

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function readHostCpuSample() {
  const content =
    await readFile(
      join(hostProcDir, "stat"),
      "utf8",
    );

  const line =
    content
      .split(/\r?\n/)
      .find((entry) =>
        entry.startsWith("cpu "),
      );

  if (!line) {
    throw new Error(
      "Statistik CPU host tidak tersedia.",
    );
  }

  const values =
    line
      .trim()
      .split(/\s+/)
      .slice(1)
      .map(Number);

  if (
    values.length < 4 ||
    values.some(
      (value) =>
        !Number.isFinite(value),
    )
  ) {
    throw new Error(
      "Statistik CPU host tidak valid.",
    );
  }

  const idle =
    (values[3] ?? 0) +
    (values[4] ?? 0);

  const total =
    values.reduce(
      (sum, value) =>
        sum + value,
      0,
    );

  return {
    idle,
    total,
  };
}

async function readHostCpuUsage() {
  const first =
    await readHostCpuSample();

  await sleep(200);

  const second =
    await readHostCpuSample();

  const totalDelta =
    second.total -
    first.total;

  const idleDelta =
    second.idle -
    first.idle;

  if (totalDelta <= 0) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      100,
      ((totalDelta - idleDelta) /
        totalDelta) *
        100,
    ),
  );
}

async function readHostMemory() {
  const content =
    await readFile(
      join(hostProcDir, "meminfo"),
      "utf8",
    );

  const values =
    new Map();

  for (
    const line of
      content.split(/\r?\n/)
  ) {
    const match =
      line.match(
        /^([A-Za-z_()]+):\s+(\d+)\s+kB$/,
      );

    if (match) {
      values.set(
        match[1],
        Number(match[2]) * 1024,
      );
    }
  }

  const total =
    values.get("MemTotal") ?? 0;

  const available =
    values.get("MemAvailable") ??
    values.get("MemFree") ??
    0;

  const used =
    Math.max(
      0,
      total - available,
    );

  return {
    total,
    used,
    available,
    usage:
      total > 0
        ? (used / total) * 100
        : 0,
  };
}

async function readHostLoad() {
  const content =
    (
      await readFile(
        join(hostProcDir, "loadavg"),
        "utf8",
      )
    ).trim();

  const parts =
    content.split(/\s+/);

  return {
    one:
      Number(parts[0]) || 0,
    five:
      Number(parts[1]) || 0,
    fifteen:
      Number(parts[2]) || 0,
  };
}

async function readHostUptime() {
  const content =
    (
      await readFile(
        join(hostProcDir, "uptime"),
        "utf8",
      )
    ).trim();

  return (
    Number(
      content.split(/\s+/)[0],
    ) || 0
  );
}

async function readHostCpuCores() {
  const content =
    await readFile(
      join(hostProcDir, "cpuinfo"),
      "utf8",
    );

  const cores =
    content
      .split(/\r?\n/)
      .filter((line) =>
        /^processor\s*:/.test(line),
      )
      .length;

  return Math.max(
    1,
    cores,
  );
}

async function readHostDisk() {
  const stats =
    await statfs(
      hostRootDir,
    );

  const blockSize =
    Number(stats.bsize);

  const total =
    Number(stats.blocks) *
    blockSize;

  const available =
    Number(stats.bavail) *
    blockSize;

  const used =
    Math.max(
      0,
      total - available,
    );

  return {
    total,
    used,
    available,
    usage:
      total > 0
        ? (used / total) * 100
        : 0,
  };
}

function runCommandCapture(
  command,
  args,
) {
  return new Promise(
    (resolve, reject) => {
      const child =
        spawn(
          command,
          args,
          {
            stdio: [
              "ignore",
              "pipe",
              "pipe",
            ],
          },
        );

      let stdout = "";
      let stderr = "";

      child.stdout.on(
        "data",
        (chunk) => {
          stdout +=
            chunk.toString();
        },
      );

      child.stderr.on(
        "data",
        (chunk) => {
          stderr +=
            chunk.toString();
        },
      );

      child.on(
        "error",
        reject,
      );

      child.on(
        "close",
        (code) => {
          if (code !== 0) {
            reject(
              new Error(
                stderr.trim() ||
                `${command} keluar dengan kode ${code}.`,
              ),
            );
            return;
          }

          resolve(
            stdout.trim(),
          );
        },
      );
    },
  );
}

async function readDockerStatus() {
  try {
    const output =
      await runCommandCapture(
        "docker",
        [
          "ps",
          "-a",
          "--format",
          "{{.State}}",
        ],
      );

    const states =
      output
        ? output.split(/\r?\n/)
        : [];

    const running =
      states.filter(
        (state) =>
          state.trim() ===
          "running",
      ).length;

    return {
      status: "healthy",
      total:
        states.length,
      running,
      stopped:
        states.length -
        running,
    };
  } catch {
    return {
      status: "error",
      total: 0,
      running: 0,
      stopped: 0,
    };
  }
}

async function collectSystemMetrics() {
  const [
    cpuUsage,
    memory,
    disk,
    load,
    uptime,
    cores,
    docker,
  ] =
    await Promise.all([
      readHostCpuUsage(),
      readHostMemory(),
      readHostDisk(),
      readHostLoad(),
      readHostUptime(),
      readHostCpuCores(),
      readDockerStatus(),
    ]);

  return {
    timestamp:
      new Date().toISOString(),

    cpu: {
      usage:
        Number(
          cpuUsage.toFixed(1),
        ),
      cores,
    },

    memory: {
      total:
        memory.total,
      used:
        memory.used,
      available:
        memory.available,
      usage:
        Number(
          memory.usage.toFixed(1),
        ),
    },

    disk: {
      total:
        disk.total,
      used:
        disk.used,
      available:
        disk.available,
      usage:
        Number(
          disk.usage.toFixed(1),
        ),
    },

    load: {
      one:
        load.one,
      five:
        load.five,
      fifteen:
        load.fifteen,
    },

    uptime,

    docker,
  };
}


async function getProjectRuntimeContainers(projectSlug) {
  const slug =
    safeSlug(projectSlug);

  if (
    !slug ||
    slug !== projectSlug
  ) {
    throw new Error(
      "Slug project runtime tidak valid.",
    );
  }

  const resourceLabel =
    label(
      PROJECT_LABEL_KEY,
      slug,
    );

  const containers =
    await listContainersByLabel(
      resourceLabel,
    );

  if (!containers.length) {
    throw new Error(
      "Container runtime project tidak ditemukan. Deploy project terlebih dahulu.",
    );
  }

  const appBase =
    containerName(slug);

  const appContainers =
    containers.filter(
      (name) =>
        name === appBase ||
        name.startsWith(
          `${appBase}-`,
        ),
    );

  if (
    appContainers.length !== 1
  ) {
    throw new Error(
      `Runtime app project tidak valid. Ditemukan ${appContainers.length} container app.`,
    );
  }

  const app =
    appContainers[0];

  const background =
    containers.filter(
      (name) =>
        name !== app,
    );

  return {
    slug,
    app,
    background,
    all: [
      app,
      ...background,
    ],
  };
}


async function getProjectContainerLogs({
  projectSlug,
  service,
  tail,
}) {
  const runtime =
    await getProjectRuntimeContainers(
      projectSlug,
    );

  if (
    ![
      "app",
      "worker",
      "scheduler",
    ].includes(service)
  ) {
    throw new Error(
      "Service log tidak valid.",
    );
  }

  const safeTail =
    Number.isInteger(tail)
      ? Math.min(
          500,
          Math.max(
            20,
            tail,
          ),
        )
      : 200;

  let container =
    null;

  if (service === "app") {
    container =
      runtime.app;
  }

  if (service === "worker") {
    container =
      runtime.background.find(
        (name) =>
          name.endsWith("-worker"),
      ) ?? null;
  }

  if (service === "scheduler") {
    container =
      runtime.background.find(
        (name) =>
          name.endsWith("-scheduler"),
      ) ?? null;
  }

  if (!container) {
    throw new Error(
      `Container ${service} project tidak ditemukan.`,
    );
  }

  const running =
    await containerRunning(
      container,
    );

  const rawLogs =
    await diagnoseContainer(
      container,
      safeTail,
    );

  return {
    service,
    container,
    running,
    tail:
      safeTail,
    logs:
      sanitizeLogMessage(
        rawLogs,
      ),
  };
}


async function getProjectRuntimeStatus(projectSlug) {
  const runtime =
    await getProjectRuntimeContainers(
      projectSlug,
    );

  const appRunning =
    await containerRunning(
      runtime.app,
    );

  let stats = {
    cpu: 0,
    memoryUsed: "0B",
    memoryPercent: 0,
  };

  if (appRunning) {
    stats =
      await containerStats(
        runtime.app,
      );
  }

  const worker =
    runtime.background.find(
      (name) =>
        name.endsWith("-worker"),
    ) ?? null;

  const scheduler =
    runtime.background.find(
      (name) =>
        name.endsWith("-scheduler"),
    ) ?? null;

  const workerRunning =
    worker
      ? await containerRunning(worker)
      : false;

  const schedulerRunning =
    scheduler
      ? await containerRunning(
          scheduler,
        )
      : false;

  return {
    status:
      appRunning
        ? "Healthy"
        : "Stopped",

    app: {
      name:
        runtime.app,
      running:
        appRunning,
      cpu:
        Number(
          stats.cpu.toFixed(1),
        ),
      memoryUsed:
        stats.memoryUsed,
      memoryPercent:
        Number(
          stats.memoryPercent.toFixed(1),
        ),
    },

    worker: {
      name:
        worker,
      running:
        workerRunning,
    },

    scheduler: {
      name:
        scheduler,
      running:
        schedulerRunning,
    },
  };
}

async function stopProjectRuntime(projectSlug) {
  const runtime =
    await getProjectRuntimeContainers(
      projectSlug,
    );

  /*
   * Worker dan scheduler dihentikan terlebih dahulu,
   * lalu HTTP app terakhir.
   */
  for (
    const name of
      runtime.background
  ) {
    if (
      await containerRunning(name)
    ) {
      await stopContainer(name);
    }
  }

  if (
    await containerRunning(
      runtime.app,
    )
  ) {
    await stopContainer(
      runtime.app,
    );
  }

  const states = {};

  for (
    const name of
      runtime.all
  ) {
    states[name] =
      await containerRunning(name);
  }

  const stillRunning =
    Object.entries(states)
      .filter(([, running]) =>
        running,
      )
      .map(([name]) => name);

  if (stillRunning.length) {
    throw new Error(
      `Sebagian container masih berjalan: ${stillRunning.join(", ")}`,
    );
  }

  return {
    status: "Stopped",
    app:
      runtime.app,
    background:
      runtime.background,
    containers:
      states,
  };
}

async function startProjectRuntime(projectSlug) {
  const runtime =
    await getProjectRuntimeContainers(
      projectSlug,
    );

  /*
   * Web app dinyalakan dahulu.
   */
  if (
    !await containerRunning(
      runtime.app,
    )
  ) {
    await startExistingContainer(
      runtime.app,
    );
  }

  /*
   * Jangan nyalakan worker/scheduler sebelum
   * web application terbukti sehat.
   */
  const healthy =
    await waitForHealthy(
      runtime.app,
      CONTAINER_PORT,
    );

  if (!healthy) {
    await stopContainer(
      runtime.app,
    ).catch(() => {});

    throw new Error(
      "Container app berhasil dinyalakan tetapi gagal health check HTTP.",
    );
  }

  const startedBackground = [];

  try {
    for (
      const name of
        runtime.background
    ) {
      if (
        !await containerRunning(name)
      ) {
        await startExistingContainer(
          name,
        );
      }

      startedBackground.push(
        name,
      );
    }
  } catch (error) {
    for (
      const name of
        startedBackground
    ) {
      await stopContainer(
        name,
      ).catch(() => {});
    }

    await stopContainer(
      runtime.app,
    ).catch(() => {});

    throw error;
  }

  const states = {};

  for (
    const name of
      runtime.all
  ) {
    states[name] =
      await containerRunning(name);
  }

  const notRunning =
    Object.entries(states)
      .filter(([, running]) =>
        !running,
      )
      .map(([name]) => name);

  if (notRunning.length) {
    throw new Error(
      `Sebagian runtime gagal berjalan: ${notRunning.join(", ")}`,
    );
  }

  return {
    status: "Healthy",
    health: "healthy",
    app:
      runtime.app,
    background:
      runtime.background,
    containers:
      states,
  };
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
            "GET" &&
          url.pathname ===
            "/system/metrics"
        ) {
          try {
            const metrics =
              await collectSystemMetrics();

            return json(
              response,
              200,
              {
                ok: true,
                metrics,
              },
            );
          } catch (error) {
            return json(
              response,
              500,
              {
                error:
                  sanitizeLogMessage(
                    error instanceof Error
                      ? error.message
                      : "Metrics VPS gagal dibaca.",
                  ),
              },
            );
          }
        }

        const projectLogsMatch =
          url.pathname.match(
            /^\/projects\/([^/]+)\/logs$/,
          );

        if (
          request.method ===
            "GET" &&
          projectLogsMatch
        ) {
          if (!authorized(request)) {
            return json(
              response,
              401,
              {
                error:
                  "Unauthorized.",
              },
            );
          }

          const projectId =
            projectLogsMatch[1];

          const projectSlug =
            url.searchParams.get(
              "projectSlug",
            );

          const service =
            url.searchParams.get(
              "service",
            ) || "app";

          const tailParam =
            Number(
              url.searchParams.get(
                "tail",
              ) || "200",
            );

          if (!projectSlug) {
            return json(
              response,
              400,
              {
                error:
                  "projectSlug wajib diisi.",
              },
            );
          }

          if (
            ![
              "app",
              "worker",
              "scheduler",
            ].includes(service)
          ) {
            return json(
              response,
              400,
              {
                error:
                  "service log tidak valid.",
              },
            );
          }

          const tail =
            Number.isFinite(
              tailParam,
            )
              ? Math.trunc(
                  tailParam,
                )
              : 200;

          try {
            const result =
              await getProjectContainerLogs({
                projectSlug,
                service,
                tail,
              });

            return json(
              response,
              200,
              {
                ok: true,
                projectId,
                ...result,
              },
            );
          } catch (error) {
            return json(
              response,
              404,
              {
                error:
                  sanitizeLogMessage(
                    error instanceof Error
                      ? error.message
                      : "Log container project tidak tersedia.",
                  ),
              },
            );
          }
        }


        const projectRuntimeStatusMatch =
          url.pathname.match(
            /^\/projects\/([^/]+)\/runtime\/status$/,
          );

        if (
          request.method === "GET" &&
          projectRuntimeStatusMatch
        ) {
          const projectId =
            projectRuntimeStatusMatch[1];

          const projectSlug =
            url.searchParams.get(
              "projectSlug",
            );

          if (!projectSlug) {
            return json(
              response,
              400,
              {
                error:
                  "projectSlug wajib diisi.",
              },
            );
          }

          try {
            const runtime =
              await getProjectRuntimeStatus(
                projectSlug,
              );

            return json(
              response,
              200,
              {
                ok: true,
                projectId,
                runtime,
              },
            );
          } catch (error) {
            return json(
              response,
              404,
              {
                error:
                  sanitizeLogMessage(
                    error instanceof Error
                      ? error.message
                      : "Runtime project tidak tersedia.",
                  ),
              },
            );
          }
        }

        const projectRuntimeMatch =
          url.pathname.match(
            /^\/projects\/([^/]+)\/runtime\/(start|stop)$/,
          );

        if (
          request.method ===
            "POST" &&
          projectRuntimeMatch
        ) {
          const projectId =
            projectRuntimeMatch[1];

          const action =
            projectRuntimeMatch[2];

          const payload =
            await body(request);

          if (
            typeof payload.projectSlug !==
              "string" ||
            !payload.projectSlug.trim()
          ) {
            return json(
              response,
              400,
              {
                error:
                  "projectSlug runtime wajib diisi.",
              },
            );
          }

          try {
            const runtime =
              action === "start"
                ? await startProjectRuntime(
                    payload.projectSlug,
                  )
                : await stopProjectRuntime(
                    payload.projectSlug,
                  );

            return json(
              response,
              200,
              {
                ok: true,
                projectId,
                action,
                runtime,
              },
            );
          } catch (error) {
            return json(
              response,
              409,
              {
                error:
                  sanitizeLogMessage(
                    error instanceof Error
                      ? error.message
                      : "Operasi runtime project gagal.",
                  ),
              },
            );
          }
        }

        const databaseBackupDeleteMatch =
          url.pathname.match(
            /^\/projects\/([^/]+)\/database\/backup\/delete$/,
          );

        if (
          request.method === "POST" &&
          databaseBackupDeleteMatch
        ) {
          const projectId =
            databaseBackupDeleteMatch[1];

          const payload =
            await body(request);

          if (
            !["MariaDB", "PostgreSQL"].includes(
              payload.databaseType,
            )
          ) {
            return json(
              response,
              400,
              {
                error:
                  "databaseType backup tidak valid.",
              },
            );
          }

          if (
            typeof payload.fileName !== "string" ||
            !payload.fileName ||
            basename(payload.fileName) !==
              payload.fileName
          ) {
            return json(
              response,
              400,
              {
                error:
                  "Nama file backup tidak valid.",
              },
            );
          }

          const validFile =
            payload.databaseType === "MariaDB"
              ? /^\d{8}T\d{6}Z-(pre-migrate|pre-restore)\.sql$/.test(
                  payload.fileName,
                )
              : /^\d{8}T\d{6}Z-(pre-migrate|pre-restore)\.dump$/.test(
                  payload.fileName,
                );

          if (!validFile) {
            return json(
              response,
              400,
              {
                error:
                  "Format file backup tidak valid.",
              },
            );
          }

          const backupDirectory =
            payload.databaseType === "MariaDB"
              ? join(
                  projectsDir,
                  projectId,
                  "backups",
                  "database",
                )
              : join(
                  projectsDir,
                  projectId,
                  "backups",
                );

          const backupPath =
            join(
              backupDirectory,
              payload.fileName,
            );

          try {
            await rm(
              backupPath,
              {
                force: true,
              },
            );

            return json(
              response,
              200,
              {
                ok: true,
                deleted:
                  payload.fileName,
              },
            );
          } catch (error) {
            return json(
              response,
              500,
              {
                error:
                  sanitizeLogMessage(
                    error instanceof Error
                      ? error.message
                      : "File backup gagal dihapus.",
                  ),
              },
            );
          }
        }

        const databaseTestMatch =
          url.pathname.match(
            /^\/projects\/([^/]+)\/database\/test$/,
          );

        if (
          request.method ===
            "POST" &&
          databaseTestMatch
        ) {
          if (!authorized(request)) {
            return json(
              response,
              401,
              {
                error:
                  "Unauthorized.",
              },
            );
          }

          const projectId =
            databaseTestMatch[1];

          const payload =
            await body(
              request,
            );

          if (
            ![
              "MariaDB",
              "PostgreSQL",
            ].includes(
              payload.databaseType,
            )
          ) {
            return json(
              response,
              400,
              {
                error:
                  "databaseType test tidak valid.",
              },
            );
          }

          try {
            const connection =
              await testDatabaseConnection({
                projectId,
                databaseType:
                  payload.databaseType,
              });

            return json(
              response,
              200,
              {
                ok: true,
                connection,
              },
            );
          } catch (error) {
            return json(
              response,
              500,
              {
                ok: false,
                error:
                  sanitizeLogMessage(
                    error instanceof Error
                      ? error.message
                      : "Test koneksi database gagal.",
                  ),
              },
            );
          }
        }


        const databaseRestoreMatch =
          url.pathname.match(
            /^\/projects\/([^/]+)\/database\/restore$/,
          );

        if (
          request.method ===
            "POST" &&
          databaseRestoreMatch
        ) {
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
                  "Unauthorized.",
              },
            );
          }

          const projectId =
            databaseRestoreMatch[1];

          const payload =
            await body(
              request,
            );

          if (
            ![
              "MariaDB",
              "PostgreSQL",
            ].includes(
              payload.databaseType,
            )
          ) {
            return json(
              response,
              400,
              {
                error:
                  "databaseType restore tidak valid.",
              },
            );
          }

          if (
            typeof payload.backupFileName !==
              "string" ||
            !payload.backupFileName.trim()
          ) {
            return json(
              response,
              400,
              {
                error:
                  "backupFileName restore wajib diisi.",
              },
            );
          }

          try {
            const restore =
              await restoreManualDatabaseBackup({
                projectId,
                databaseType:
                  payload.databaseType,
                backupFileName:
                  payload.backupFileName,
              });

            return json(
              response,
              200,
              {
                ok: true,
                restore,
              },
            );
          } catch (error) {
            return json(
              response,
              500,
              {
                error:
                  sanitizeLogMessage(
                    error instanceof Error
                      ? error.message
                      : "Restore database gagal.",
                  ),
              },
            );
          }
        }


        const databaseBackupMatch =
          url.pathname.match(
            /^\/projects\/([^/]+)\/database\/backup$/,
          );

        if (
          request.method ===
            "POST" &&
          databaseBackupMatch
        ) {
          const projectId =
            databaseBackupMatch[1];

          const payload =
            await body(
              request,
            );

          if (
            ![
              "MariaDB",
              "PostgreSQL",
            ].includes(
              payload.databaseType,
            )
          ) {
            return json(
              response,
              400,
              {
                error:
                  "databaseType backup tidak valid.",
              },
            );
          }

          const retention =
            payload.retention === undefined
              ? 7
              : Number(
                  payload.retention,
                );

          if (
            !Number.isInteger(
              retention,
            ) ||
            retention < 1 ||
            retention > 100
          ) {
            return json(
              response,
              400,
              {
                error:
                  "Retention backup harus antara 1 sampai 100.",
              },
            );
          }

          try {
            const backup =
              await createManualDatabaseBackup({
                projectId,
                databaseType:
                  payload.databaseType,
                retention,
              });

            return json(
              response,
              200,
              {
                ok: true,
                backup,
              },
            );
          } catch (error) {
            return json(
              response,
              500,
              {
                error:
                  sanitizeLogMessage(
                    error instanceof Error
                      ? error.message
                      : "Backup database gagal.",
                  ),
              },
            );
          }
        }

        const cleanupMatch =
          url.pathname.match(
            /^\/projects\/([^/]+)\/cleanup$/,
          );

        if (
          request.method ===
            "POST" &&
          cleanupMatch
        ) {
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

          const projectId =
            cleanupMatch[1];

          const payload =
            await body(
              request,
            );

          if (
            typeof payload.projectName !==
              "string" ||
            !payload.projectName.trim()
          ) {
            return json(
              response,
              400,
              {
                error:
                  "projectName wajib diisi.",
              },
            );
          }

          if (
            ![
              "MariaDB",
              "PostgreSQL",
              "Tanpa database",
            ].includes(
              payload.databaseType,
            )
          ) {
            return json(
              response,
              400,
              {
                error:
                  "databaseType tidak valid.",
              },
            );
          }

          try {
            const cleanup =
              await permanentlyCleanupProject({
                projectId,
                projectName:
                  payload.projectName,
                databaseType:
                  payload.databaseType,
              });

            return json(
              response,
              200,
              {
                ok:
                  true,
                cleanup,
              },
            );
          } catch (error) {
            return json(
              response,
              500,
              {
                error:
                  sanitizeLogMessage(
                    error instanceof Error
                      ? error.message
                      : "Cleanup project gagal.",
                  ),
              },
            );
          }
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

          if (
            payload.environment !== undefined
          ) {
            if (
              !payload.environment ||
              typeof payload.environment !== "object" ||
              Array.isArray(
                payload.environment,
              )
            ) {
              return json(
                response,
                400,
                {
                  error:
                    "Environment deployment tidak valid.",
                },
              );
            }

            try {
              await saveProjectEnvironment(
                projectsDir,
                payload.projectId,
                payload.environment,
              );
            } catch (error) {
              return json(
                response,
                400,
                {
                  error:
                    error instanceof Error
                      ? error.message
                      : "Environment deployment tidak dapat disimpan.",
                },
              );
            }

            console.log(
              `PANEL_ENVIRONMENT_SAVED project=${payload.projectId} variables=${Object.keys(payload.environment).length}`,
            );
          }
          const job = {
            id:
              randomUUID(),

            type:
              "deploy",

            status:
              "awaiting_archive",
            payload: {
              ...payload,
              environment:
                undefined,
            },


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
