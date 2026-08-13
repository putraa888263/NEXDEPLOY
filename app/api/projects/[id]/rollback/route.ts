import { NextResponse } from "next/server";
import { getD1 } from "@/db/bootstrap";
import { requireUser } from "../../../_lib/auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(request);
  if (user.role === "Viewer") return NextResponse.json({ error: "Role Viewer tidak dapat meminta rollback." }, { status: 403 });
  const { id } = await params;
  const source = await getD1().prepare("SELECT id, archive_key AS archiveKey, archive_name AS archiveName FROM deployments WHERE project_id = ? AND status = 'Succeeded' AND action = 'Deploy' ORDER BY finished_at DESC LIMIT 1").bind(id).first<{ id: string; archiveKey: string; archiveName: string }>();
  if (!source) return NextResponse.json({ error: "Belum ada deployment berhasil yang dapat dijadikan rollback." }, { status: 400 });
  const now = new Date().toISOString();
  const rollbackId = crypto.randomUUID();
  const message = "Executor rollback belum dikonfigurasi. Versi aktif belum diubah.";
  await getD1().batch([
    getD1().prepare("INSERT INTO deployments (id, project_id, status, requested_by, archive_key, archive_name, executor, action, source_deployment_id, error, created_at, finished_at) VALUES (?, ?, 'WaitingExecutor', ?, ?, ?, 'local-worker', 'Rollback', ?, ?, ?, ?)").bind(rollbackId, id, user.id, source.archiveKey, source.archiveName, source.id, message, now, now),
    getD1().prepare("INSERT INTO deployment_logs (id, deployment_id, level, message, created_at) VALUES (?, ?, 'warning', ?, ?)").bind(crypto.randomUUID(), rollbackId, message, now),
    getD1().prepare("INSERT INTO activity (id, project_id, type, title, detail, created_at) VALUES (?, ?, 'deployment', ?, ?, ?)").bind(crypto.randomUUID(), id, "Rollback diantrikan", `${user.name} meminta rollback ke ${source.archiveName}.`, now),
  ]);
  return NextResponse.json({ deployment: { id: rollbackId, status: "WaitingExecutor" } }, { status: 202 });
}
