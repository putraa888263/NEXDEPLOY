import { NextResponse } from "next/server";
import { getD1 } from "@/db/bootstrap";
import { requireUser } from "../../../_lib/auth";
import { processDeployment } from "../../../_lib/deployment";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(request);
  if (user.role === "Viewer") return NextResponse.json({ error: "Role Viewer tidak dapat mencoba ulang deployment." }, { status: 403 });
  const { id } = await params;
  const source = await getD1().prepare("SELECT project_id AS projectId, archive_key AS archiveKey, archive_name AS archiveName FROM deployments WHERE id = ? AND status IN ('Failed', 'WaitingExecutor')").bind(id).first<{ projectId: string; archiveKey: string; archiveName: string }>();
  if (!source) return NextResponse.json({ error: "Hanya deployment gagal atau menunggu executor yang dapat dicoba ulang." }, { status: 400 });
  const project = await getD1().prepare("SELECT name, framework FROM projects WHERE id = ?").bind(source.projectId).first<{ name: string; framework: string }>();
  if (!project) return NextResponse.json({ error: "Project tidak ditemukan." }, { status: 404 });
  const deployment = { id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  await getD1().batch([
    getD1().prepare("INSERT INTO deployments (id, project_id, status, requested_by, archive_key, archive_name, executor, action, source_deployment_id, created_at) VALUES (?, ?, 'Queued', ?, ?, ?, 'local-worker', 'Deploy', ?, ?)").bind(deployment.id, source.projectId, user.id, source.archiveKey, source.archiveName, id, deployment.createdAt),
    getD1().prepare("INSERT INTO activity (id, project_id, type, title, detail, created_at) VALUES (?, ?, 'deployment', ?, ?, ?)").bind(crypto.randomUUID(), source.projectId, "Deployment dicoba ulang", `${user.name} mencoba ulang ${source.archiveName}.`, deployment.createdAt),
  ]);
  await processDeployment(deployment.id, { id: source.projectId, name: project.name, archive_key: source.archiveKey, archive_name: source.archiveName, framework: project.framework });
  return NextResponse.json({ deployment }, { status: 202 });
}
