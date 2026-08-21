  import { NextResponse } from "next/server";
  import { getD1 } from "@/db/bootstrap";
  import { requireUser } from "../../../_lib/auth";
  import { processDeployment } from "../../../_lib/deployment";

  export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    await requireUser(request);
    const { id } = await params;
    const results = await getD1().prepare("SELECT id, status, archive_name AS archiveName, executor, action, source_deployment_id AS sourceDeploymentId, error, created_at AS createdAt, started_at AS startedAt, finished_at AS finishedAt FROM deployments WHERE project_id = ? ORDER BY created_at DESC LIMIT 20").bind(id).all();
    return NextResponse.json({ deployments: results.results ?? [] });
  }

  export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await requireUser(request);
    if (user.role === "Viewer") return NextResponse.json({ error: "Role Viewer tidak dapat memulai deployment." }, { status: 403 });
    const { id } = await params;
    const project = await getD1().prepare("SELECT id, name, archive_key, archive_name, framework FROM projects WHERE id = ?").bind(id).first<{ id: string; name: string; archive_key: string | null; archive_name: string | null; framework: string }>();
    if (!project) return NextResponse.json({ error: "Project tidak ditemukan." }, { status: 404 });
    if (!project.archive_key || !project.archive_name) return NextResponse.json({ error: "Unggah ZIP aplikasi yang valid sebelum deployment." }, { status: 400 });
    const running = await getD1().prepare("SELECT id FROM deployments WHERE project_id = ? AND status IN ('Queued', 'Running')").bind(id).first();
    if (running) return NextResponse.json({ error: "Deployment untuk project ini masih berjalan." }, { status: 409 });
    const deployment = { id: crypto.randomUUID(), status: "Queued", archiveName: project.archive_name, executor: "local-worker", createdAt: new Date().toISOString() };
    await getD1().batch([
      getD1().prepare("INSERT INTO deployments (id, project_id, status, requested_by, archive_key, archive_name, executor, action, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'Deploy', ?)").bind(deployment.id, id, deployment.status, user.id, project.archive_key, project.archive_name, deployment.executor, deployment.createdAt),
      getD1().prepare("INSERT INTO activity (id, project_id, type, title, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), id, "deployment", "Deployment diantrikan", `${user.name} meminta deployment ${project.archive_name}.`, deployment.createdAt),
    ]);
    await processDeployment(deployment.id, { ...project, archive_key: project.archive_key, archive_name: project.archive_name });
    return NextResponse.json({ deployment }, { status: 202 });
  }
