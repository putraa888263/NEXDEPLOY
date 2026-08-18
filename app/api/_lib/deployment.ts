import { getD1, getUploads } from "@/db/bootstrap";
import { decryptEnvironmentValue } from "./environment";

type ProjectForDeployment = { id: string; name: string; archive_key: string; archive_name: string; framework: string };

async function writeLog(deploymentId: string, level: "info" | "success" | "warning" | "error", message: string) {
  await getD1().prepare("INSERT INTO deployment_logs (id, deployment_id, level, message, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), deploymentId, level, message, new Date().toISOString()).run();
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
        };
      };

    const output =
      await logResponse.json() as {
        logs?: ExecutorLog[];
      };

    const executorStatus =
      job.job?.status;
    const finishedAt = job.job?.finishedAt;

    const status =
      executorStatus === "succeeded" || (executorStatus === "running" && finishedAt)
        ? "Succeeded"
        : executorStatus === "failed"
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

    for (
      const [
        index,
        log,
      ] of (
        output.logs ?? []
      ).entries()
    ) {
      const marker =
        `[executor:${deployment.executor_job_id}:${index}]`;

      const exists =
        await db
          .prepare(
            `SELECT id
             FROM deployment_logs
             WHERE deployment_id = ?
             AND message LIKE ?`,
          )
          .bind(
            deploymentId,
            `${marker}%`,
          )
          .first();

      if (!exists) {
        await writeLog(
          deploymentId,
          log.level ?? "info",
          `${marker} ${
            log.message ??
            "Executor memperbarui job."
          }`,
        );
      }
    }
  } catch {
    /*
     * Executor mungkin sementara offline.
     * Pertahankan state terakhir yang diketahui.
     */
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
    const response = await fetch(`${executor.url}/jobs/deploy`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${await decryptEnvironmentValue(executor.token_encrypted)}` },
      body: JSON.stringify({ projectId: project.id, projectName: project.name, archiveName: project.archive_name, framework: project.framework }),
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
