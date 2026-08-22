import { getD1, getUploads } from "@/db/bootstrap";
import { env } from "cloudflare:workers";
import { decryptEnvironmentValue } from "./environment";
import { ensureNpmProxyHost } from "./npm";

type ProjectForDeployment = {
  id: string;
  name: string;
  archive_key: string;
  archive_name: string;
  framework: string;
  database: "MariaDB" | "PostgreSQL" | "Tanpa database";
  domain?: string | null;
};

function sanitizeDeploymentLog(message: string) {
  return message
    .replace(
      /\b(authorization)\s*:\s*bearer\s+[^\s,;]+/gi,
      "$1: Bearer [REDACTED]",
    )
    .replace(
      /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
      "Bearer [REDACTED]",
    )
    .replace(
      /\b(APP_KEY|DB_PASSWORD|DB_USERNAME|DATABASE_URL|REDIS_PASSWORD|MAIL_PASSWORD|API_KEY|TOKEN|SECRET|PASSWORD)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/gi,
      "$1=[REDACTED]",
    )
    .replace(
      /("?(?:password|token|secret|api[_-]?key|app[_-]?key|db[_-]?password)"?\s*:\s*)("[^"]*"|'[^']*'|[^,\s}]+)/gi,
      '$1"[REDACTED]"',
    );
}

async function writeLog(
  deploymentId: string,
  level: "info" | "success" | "warning" | "error",
  message: string,
) {
  await getD1()
    .prepare(
      "INSERT INTO deployment_logs (id, deployment_id, level, message, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(
      crypto.randomUUID(),
      deploymentId,
      level,
      sanitizeDeploymentLog(message),
      new Date().toISOString(),
    )
    .run();
}

async function writeLogOnce(
  deploymentId: string,
  level: "info" | "success" | "warning" | "error",
  marker: string,
  message: string,
) {
  const exists = await getD1()
    .prepare(
      `SELECT id
       FROM deployment_logs
       WHERE deployment_id = ?
       AND message LIKE ?
       LIMIT 1`,
    )
    .bind(
      deploymentId,
      `${marker}%`,
    )
    .first();

  if (exists) {
    return;
  }

  await writeLog(
    deploymentId,
    level,
    `${marker} ${message}`,
  );
}

type ExecutorLog = { at?: string; level?: "info" | "success" | "warning" | "error"; message?: string };

export async function syncExecutorDeployment(deploymentId: string) {
  const db = getD1();

  const deployment = await db
    .prepare(
      `SELECT
        id,
        project_id,
        executor_job_id,
        created_at
       FROM deployments
       WHERE id = ?`,
    )
    .bind(deploymentId)
    .first<{
      id: string;
      project_id: string;
      executor_job_id: string | null;
      created_at: string;
    }>();

  const executor = await db
    .prepare(
      "SELECT url, token_encrypted FROM executor_settings WHERE id = 1",
    )
    .first<{
      url: string;
      token_encrypted: string;
    }>();

  if (
    !deployment?.executor_job_id ||
    !executor
  ) {
    return;
  }

  const headers = {
    authorization:
      `Bearer ${await decryptEnvironmentValue(
        executor.token_encrypted,
      )}`,
  };

  try {
    const [
      jobResponse,
      logResponse,
    ] = await Promise.all([
      fetch(
        `${executor.url}/jobs/${deployment.executor_job_id}`,
        { headers },
      ),
      fetch(
        `${executor.url}/jobs/${deployment.executor_job_id}/logs`,
        { headers },
      ),
    ]);

    if (
      !jobResponse.ok ||
      !logResponse.ok
    ) {
      return;
    }

    const job =
      await jobResponse.json() as {
        job?: {
          status?: string;
          finishedAt?: string;
          hostPort?: number;
        };
      };

    const output =
      await logResponse.json() as {
        logs?: ExecutorLog[];
      };

    const executorLogs =
      output.logs ?? [];

    const hasExecutorSuccessLog =
      executorLogs.some((log) =>
        /\[SUCCESS\]|Aplikasi Laravel berhasil dijalankan/.test(
          log.message ?? "",
        ),
      );

    const hasExecutorFailureLog =
      executorLogs.some((log) =>
        /\[FAILURE\]|Deployment gagal pada tahap/.test(
          log.message ?? "",
        ),
      );

    const executorStatus =
      job.job?.status;

    const finishedAt =
      job.job?.finishedAt;

    const status =
      (
        executorStatus === "succeeded" &&
        hasExecutorSuccessLog
      ) ||
      (
        executorStatus === "running" &&
        finishedAt &&
        hasExecutorSuccessLog
      )
        ? "Succeeded"
        : (
            executorStatus === "failed" ||
            hasExecutorFailureLog
          )
          ? "Failed"
          : executorStatus === "waiting_vps"
            ? "WaitingExecutor"
            : executorStatus === "awaiting_archive"
              ? "Queued"
              : "Running";

    const now =
      new Date().toISOString();

    await db
      .prepare(
        `UPDATE deployments
         SET
           status = ?,
           error = CASE
             WHEN ? = 'WaitingExecutor'
               THEN 'Executor menunggu konfigurasi VPS.'
             WHEN ? = 'Succeeded'
               THEN NULL
             ELSE error
           END,
           finished_at = CASE
             WHEN ? IN ('Succeeded', 'Failed')
               THEN COALESCE(finished_at, ?)
             ELSE finished_at
           END
         WHERE id = ?`,
      )
      .bind(
        status,
        status,
        status,
        status,
        now,
        deploymentId,
      )
      .run();

    /*
     * Hanya deployment TERBARU untuk project
     * yang boleh mengubah status project.
     *
     * Deployment lama yang gagal tidak boleh
     * menimpa Healthy dari release terbaru.
     */
    const latestDeployment =
      await db
        .prepare(
          `SELECT id
           FROM deployments
           WHERE project_id = ?
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .bind(
          deployment.project_id,
        )
        .first<{
          id: string;
        }>();

    const isLatestDeployment =
      latestDeployment?.id ===
      deploymentId;

    if (isLatestDeployment) {
      if (status === "Succeeded") {
        await db
          .prepare(
            `UPDATE projects
             SET
               status = 'Healthy',
               updated_at = ?
             WHERE id = ?`,
          )
          .bind(
            now,
            deployment.project_id,
          )
          .run();

      } else if (status === "Failed") {
        await db
          .prepare(
            `UPDATE projects
             SET
               status = 'Stopped',
               updated_at = ?
             WHERE id = ?`,
          )
          .bind(
            now,
            deployment.project_id,
          )
          .run();
      } else if (
        status === "Running"
      ) {
        await db
          .prepare(
            `UPDATE projects
             SET
               status = 'Deploying',
               updated_at = ?
             WHERE id = ?`,
          )
          .bind(
            now,
            deployment.project_id,
          )
          .run();
      }
    }

    const copiedLogs =
      await db
        .prepare(
          `SELECT message
           FROM deployment_logs
           WHERE deployment_id = ?
           AND message LIKE ?`,
        )
        .bind(
          deploymentId,
          `[executor:${deployment.executor_job_id}:%`,
        )
        .all<{ message: string }>();

    const copiedMarkers =
      new Set(
        (copiedLogs.results ?? [])
          .map((row) =>
            row.message.match(
              /^\[executor:[^\]]+\]/,
            )?.[0],
          )
          .filter((marker): marker is string =>
            Boolean(marker),
          ),
      );

    const copiedTerminalLog =
      executorLogs.some((log) =>
        /\[(SUCCESS|FAILURE)\]|Aplikasi Laravel berhasil dijalankan|Deployment gagal pada tahap/.test(
          log.message ?? "",
        ),
      );

    const missingLogWrites =
      executorLogs.flatMap((log, index) => {
        const marker =
          `[executor:${deployment.executor_job_id}:${index}]`;

        if (copiedMarkers.has(marker)) {
          return [];
        }

        const message =
          log.message ??
          "Executor memperbarui job.";

        const createdAt =
          log.at && !Number.isNaN(Date.parse(log.at))
            ? log.at
            : now;

        return [
          db
            .prepare(
              `INSERT OR IGNORE INTO deployment_logs
               (id, deployment_id, level, message, created_at)
               VALUES (?, ?, ?, ?, ?)`,
            )
            .bind(
              `executor:${deploymentId}:${deployment.executor_job_id}:${String(index).padStart(6, "0")}`,
              deploymentId,
              log.level ?? "info",
              sanitizeDeploymentLog(
                `${marker} ${message}`,
              ),
              createdAt,
            ),
        ];
      });

    for (
      let offset = 0;
      offset < missingLogWrites.length;
      offset += 50
    ) {
      await db.batch(
        missingLogWrites.slice(
          offset,
          offset + 50,
        ),
      );
    }

    if (
      status === "Succeeded" &&
      copiedTerminalLog &&
      !isLatestDeployment
    ) {
      await writeLogOnce(
        deploymentId,
        "warning",
        "[NPM_SKIP]",
        "Proxy Host otomatis dilewati karena deployment ini bukan deployment terbaru project.",
      );
    }

    if (
      isLatestDeployment &&
      status === "Succeeded" &&
      copiedTerminalLog &&
      !job.job?.hostPort
    ) {
      await writeLogOnce(
        deploymentId,
        "warning",
        "[NPM_SKIP]",
        "Proxy Host otomatis dilewati karena executor belum mengembalikan stable host port.",
      );
    }

    if (
      isLatestDeployment &&
      status === "Succeeded" &&
      job.job?.hostPort &&
      copiedTerminalLog
    ) {
      await syncProjectProxyHost(
        deploymentId,
        deployment.project_id,
        job.job.hostPort,
      );
    }
  } catch (error) {
    /*
     * Executor mungkin sementara offline.
     * Pertahankan state terakhir yang diketahui.
     */
    console.error(
      `Sinkronisasi log executor gagal untuk deployment ${deploymentId}: ${sanitizeDeploymentLog(
        error instanceof Error
          ? error.message
          : String(error),
      )}`,
    );
  }
}

async function syncProjectProxyHost(
  deploymentId: string,
  projectId: string,
  hostPort: number,
) {
  const db = getD1();

  const row = await db
    .prepare(
      `SELECT
        projects.domain,
        settings.npm_url AS npmUrl,
        settings.server_ip AS serverIp
       FROM projects
       CROSS JOIN settings
       WHERE projects.id = ?
       AND settings.id = 1`,
    )
    .bind(projectId)
    .first<{
      domain: string;
      npmUrl: string;
      serverIp: string;
    }>();

  if (!row?.domain || !row.npmUrl) {
    await writeLogOnce(
      deploymentId,
      "warning",
      "[NPM_SKIP]",
      "Proxy Host otomatis dilewati karena domain project atau URL NPM belum dikonfigurasi.",
    );

    return;
  }

  const forwardHost =
    ((env as unknown as { NPM_FORWARD_HOST?: string })
      .NPM_FORWARD_HOST ??
      row.serverIp).trim();

  if (!forwardHost) {
    await writeLogOnce(
      deploymentId,
      "warning",
      "[NPM_SKIP]",
      "Proxy Host otomatis dilewati karena NPM_FORWARD_HOST/server IP kosong.",
    );

    return;
  }

  try {
    await writeLogOnce(
      deploymentId,
      "info",
      "[NPM_START]",
      `Menyiapkan Proxy Host ${row.domain} ke ${forwardHost}:${hostPort}.`,
    );

    const result =
      await ensureNpmProxyHost({
        domain: row.domain,
        forwardHost,
        forwardPort: hostPort,
        npmUrl: row.npmUrl,
      });

    if (result.skipped) {
      await writeLogOnce(
        deploymentId,
        "warning",
        "[NPM_SKIP]",
        "Proxy Host otomatis dilewati karena NPM_IDENTITY/NPM_SECRET belum dikonfigurasi.",
      );

      return;
    }

    await writeLogOnce(
      deploymentId,
      "success",
      result.ssl ? "[NPM_SSL]" : "[NPM]",
      `Proxy Host ${row.domain} diarahkan ke ${forwardHost}:${hostPort}${result.ssl ? " dengan SSL." : "."}`,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "NPM tidak dapat dikonfigurasi.";

    await writeLogOnce(
      deploymentId,
      "warning",
      "[NPM_ERROR]",
      `Deployment berhasil, tetapi Proxy Host otomatis gagal: ${message}`,
    );
  }
}


export async function processDeployment(deploymentId: string, project: ProjectForDeployment) {
  const db = getD1();
  const startedAt = new Date().toISOString();
  await db.prepare("UPDATE deployments SET status = 'Running', started_at = ? WHERE id = ?").bind(startedAt, deploymentId).run();
  await db.prepare("UPDATE projects SET status = 'Deploying', updated_at = ? WHERE id = ?").bind(startedAt, project.id).run();
  await writeLog(deploymentId, "info", "Job deployment diterima oleh worker.");
  await writeLog(deploymentId, "info", `Memeriksa arsip ${project.archive_name}.`);
  const archive = await getUploads().head(project.archive_key);
  if (!archive) {
    const error = "Arsip ZIP tidak lagi tersedia di penyimpanan.";
    await failDeployment(deploymentId, project.id, error);
    return;
  }
  await writeLog(deploymentId, "success", `ZIP tersedia (${archive.size} byte).`);
  await writeLog(deploymentId, "info", `${project.framework} terdeteksi dan siap diekstrak.`);
  const executor = await db.prepare("SELECT url, token_encrypted FROM executor_settings WHERE id = 1").first<{ url: string; token_encrypted: string }>();
  if (!executor) {
    const error = "Executor belum dikonfigurasi. Simpan URL dan token executor di Pengaturan sebelum mencoba deployment.";
    await db.prepare("UPDATE deployments SET status = 'WaitingExecutor', error = ?, finished_at = ? WHERE id = ?").bind(error, new Date().toISOString(), deploymentId).run();
    await db.prepare("UPDATE projects SET status = 'Stopped', updated_at = ? WHERE id = ?").bind(new Date().toISOString(), project.id).run();
    await writeLog(deploymentId, "warning", error);
    return;
  }
  try {
    const environmentRows =
      await db
        .prepare(
          "SELECT key, value_encrypted AS valueEncrypted FROM project_environment WHERE project_id = ? ORDER BY key",
        )
        .bind(project.id)
        .all<{
          key: string;
          valueEncrypted: string;
        }>();

    const savedEnvironment =
      Object.fromEntries(
        await Promise.all(
          (environmentRows.results ?? []).map(
            async (entry) => [
              entry.key,
              await decryptEnvironmentValue(
                entry.valueEncrypted,
              ),
            ],
          ),
        ),
      );

    const httpsProjectUrl =
      project.domain
        ? `https://${project.domain}`
        : "";

    const deploymentEnvironment = {
      ...(httpsProjectUrl
        ? {
            APP_URL: httpsProjectUrl,
            ASSET_URL: httpsProjectUrl,
            VITE_APP_URL: httpsProjectUrl,
          }
        : {}),
      ...savedEnvironment,
    };

    const response = await fetch(`${executor.url}/jobs/deploy`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await decryptEnvironmentValue(
          executor.token_encrypted,
        )}`,
      },
      body: JSON.stringify({
        projectId: project.id,
        projectName: project.name,
          databaseType: project.database,
        archiveName: project.archive_name,
        framework: project.framework,
        environment: deploymentEnvironment,
      }),
    });
    const result = await response.json().catch(() => ({})) as { job?: { id?: string }; error?: string };
    if (!response.ok || !result.job?.id) throw new Error(result.error || "Executor menolak job deployment.");
    await db.prepare("UPDATE deployments SET executor_job_id = ? WHERE id = ?").bind(result.job.id, deploymentId).run();
    await writeLog(deploymentId, "success", `Job ${result.job.id} diterima executor.`);
    const archiveObject = await getUploads().get(project.archive_key);
    if (!archiveObject) throw new Error("Arsip ZIP tidak dapat dibaca dari penyimpanan.");
    const transfer = await fetch(`${executor.url}/jobs/${result.job.id}/archive`, {
      method: "PUT",
      headers: { "content-type": "application/zip", authorization: `Bearer ${await decryptEnvironmentValue(executor.token_encrypted)}` },
      body: await archiveObject.arrayBuffer(),
    });
    const transferResult = await transfer.json().catch(() => ({})) as { error?: string };
    if (!transfer.ok) throw new Error(transferResult.error || "Arsip ZIP gagal dikirim ke executor.");
    await writeLog(deploymentId, "success", "Arsip ZIP dikirim aman ke executor.");
    await syncExecutorDeployment(deploymentId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Executor tidak dapat dijangkau.";
    await failDeployment(deploymentId, project.id, `Gagal mengirim job ke executor: ${message}`);
    return;
  }
  const current = await db.prepare("SELECT status FROM deployments WHERE id = ?").bind(deploymentId).first<{ status: string }>();
  if (current?.status === "WaitingExecutor") {
    await writeLog(deploymentId, "warning", "Executor menerima release tetapi masih menunggu kesiapan deployment VPS.");
  }
}

async function failDeployment(deploymentId: string, projectId: string, error: string) {
  const now = new Date().toISOString();
  await getD1().batch([
    getD1().prepare("UPDATE deployments SET status = 'Failed', error = ?, finished_at = ? WHERE id = ?").bind(error, now, deploymentId),
    getD1().prepare("UPDATE projects SET status = 'Stopped', updated_at = ? WHERE id = ?").bind(now, projectId),
  ]);
  await writeLog(deploymentId, "error", error);
}
