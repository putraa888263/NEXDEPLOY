import { NextResponse } from "next/server";
import { getD1 } from "@/db/bootstrap";
import { requireUser } from "../../../_lib/auth";

async function addLog(jobId: string, level: string, message: string) {
  await getD1().prepare("INSERT INTO backup_logs (id, job_id, level, message, created_at) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), jobId, level, message, new Date().toISOString()).run();
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser(request);
  const { id } = await params;
  const results = await getD1().prepare("SELECT backups.id, backups.name, backups.type, backups.status, backups.size, backups.retention_days AS retentionDays, backups.created_at AS createdAt, backups.completed_at AS completedAt FROM backups WHERE project_id = ? ORDER BY created_at DESC").bind(id).all();
  return NextResponse.json({ backups: results.results ?? [] });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(request);
  if (user.role === "Viewer") return NextResponse.json({ error: "Role Viewer tidak dapat membuat backup." }, { status: 403 });
  const { id } = await params;
  const project = await getD1().prepare("SELECT id, slug FROM projects WHERE id = ?").bind(id).first<{ id: string; slug: string }>();
  if (!project) return NextResponse.json({ error: "Project tidak ditemukan." }, { status: 404 });
  const retention = await getD1().prepare("SELECT backup_retention FROM settings WHERE id = 1").first<{ backup_retention: number }>();
  const now = new Date();
  const backup = { id: crypto.randomUUID(), name: `${project.slug}-${now.toISOString().replace(/[:.]/g, "-")}`, type: "Manual", status: "WaitingExecutor", retentionDays: retention?.backup_retention ?? 7, createdAt: now.toISOString() };
  const jobId = crypto.randomUUID();
  const message = "Executor backup belum dikonfigurasi. Permintaan disimpan dan siap dijalankan di VPS.";
  await getD1().batch([
    getD1().prepare("INSERT INTO backups (id, project_id, name, type, status, retention_days, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(backup.id, id, backup.name, backup.type, backup.status, backup.retentionDays, user.id, backup.createdAt),
    getD1().prepare("INSERT INTO backup_jobs (id, backup_id, action, status, requested_by, error, created_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(jobId, backup.id, "Create", "WaitingExecutor", user.id, message, backup.createdAt, backup.createdAt),
    getD1().prepare("INSERT INTO activity (id, project_id, type, title, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), id, "backup", "Backup diantrikan", `${user.name} meminta backup ${backup.name}.`, backup.createdAt),
  ]);
  await addLog(jobId, "info", "Permintaan backup diterima.");
  await addLog(jobId, "warning", message);
  return NextResponse.json({ backup }, { status: 202 });
}
