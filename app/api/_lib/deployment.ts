import { getD1, getUploads } from "@/db/bootstrap";

type ProjectForDeployment = { id: string; name: string; archive_key: string; archive_name: string; framework: string };

async function writeLog(deploymentId: string, level: "info" | "success" | "warning" | "error", message: string) {
  await getD1().prepare("INSERT INTO deployment_logs (id, deployment_id, level, message, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), deploymentId, level, message, new Date().toISOString()).run();
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
  const error = "Executor Docker/VPS belum dikonfigurasi. ZIP telah lolos preflight dan menunggu worker server.";
  await db.prepare("UPDATE deployments SET status = 'WaitingExecutor', error = ?, finished_at = ? WHERE id = ?").bind(error, new Date().toISOString(), deploymentId).run();
  await db.prepare("UPDATE projects SET status = 'Stopped', updated_at = ? WHERE id = ?").bind(new Date().toISOString(), project.id).run();
  await writeLog(deploymentId, "warning", error);
}

async function failDeployment(deploymentId: string, projectId: string, error: string) {
  const now = new Date().toISOString();
  await getD1().batch([
    getD1().prepare("UPDATE deployments SET status = 'Failed', error = ?, finished_at = ? WHERE id = ?").bind(error, now, deploymentId),
    getD1().prepare("UPDATE projects SET status = 'Stopped', updated_at = ? WHERE id = ?").bind(now, projectId),
  ]);
  await writeLog(deploymentId, "error", error);
}
