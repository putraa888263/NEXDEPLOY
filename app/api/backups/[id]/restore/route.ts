import { NextResponse } from "next/server";
import { getD1 } from "@/db/bootstrap";
import { requireUser } from "../../../_lib/auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(request);
  if (user.role === "Viewer") return NextResponse.json({ error: "Role Viewer tidak dapat memulihkan backup." }, { status: 403 });
  const { id } = await params;
  const backup = await getD1().prepare("SELECT id, project_id AS projectId, name FROM backups WHERE id = ?").bind(id).first<{ id: string; projectId: string; name: string }>();
  if (!backup) return NextResponse.json({ error: "Backup tidak ditemukan." }, { status: 404 });
  const now = new Date().toISOString();
  const jobId = crypto.randomUUID();
  const message = "Executor restore belum dikonfigurasi. Tidak ada file atau database yang diubah.";
  await getD1().batch([
    getD1().prepare("INSERT INTO backup_jobs (id, backup_id, action, status, requested_by, error, created_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(jobId, id, "Restore", "WaitingExecutor", user.id, message, now, now),
    getD1().prepare("INSERT INTO backup_logs (id, job_id, level, message, created_at) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), jobId, "warning", message, now),
    getD1().prepare("INSERT INTO activity (id, project_id, type, title, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), backup.projectId, "backup", "Restore diantrikan", `${user.name} meminta pemulihan ${backup.name}.`, now),
  ]);
  return NextResponse.json({ job: { id: jobId, status: "WaitingExecutor" } }, { status: 202 });
}
