import { NextResponse } from "next/server";
import { getD1 } from "@/db/bootstrap";
import { requireUser } from "../../../_lib/auth";

const defaults = { phpVersion: "8.3", cpuLimit: 1, memoryLimit: 512, diskQuota: 5, internalPort: 8080 };
const phpVersions = ["8.1", "8.2", "8.3", "8.4"];

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser(request);
  const { id } = await params;
  const project = await getD1().prepare("SELECT id FROM projects WHERE id = ?").bind(id).first();
  if (!project) return NextResponse.json({ error: "Project tidak ditemukan." }, { status: 404 });
  const resource = await getD1().prepare("SELECT php_version AS phpVersion, cpu_limit AS cpuLimit, memory_limit AS memoryLimit, disk_quota AS diskQuota, internal_port AS internalPort, updated_at AS updatedAt FROM project_resources WHERE project_id = ?").bind(id).first();
  return NextResponse.json({ resources: resource ?? defaults });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(request);
  if (user.role === "Viewer") return NextResponse.json({ error: "Role Viewer tidak dapat mengubah resource." }, { status: 403 });
  const { id } = await params;
  const body = await request.json().catch(() => null) as typeof defaults | null;
  if (!body || !phpVersions.includes(body.phpVersion) || !Number.isInteger(body.cpuLimit) || body.cpuLimit < 1 || body.cpuLimit > 16 || !Number.isInteger(body.memoryLimit) || body.memoryLimit < 128 || body.memoryLimit > 32768 || !Number.isInteger(body.diskQuota) || body.diskQuota < 1 || body.diskQuota > 1000 || !Number.isInteger(body.internalPort) || body.internalPort < 1024 || body.internalPort > 65535) return NextResponse.json({ error: "Konfigurasi resource tidak valid." }, { status: 400 });
  const exists = await getD1().prepare("SELECT id FROM projects WHERE id = ?").bind(id).first();
  if (!exists) return NextResponse.json({ error: "Project tidak ditemukan." }, { status: 404 });
  const now = new Date().toISOString();
  await getD1().batch([
    getD1().prepare("INSERT INTO project_resources (project_id, php_version, cpu_limit, memory_limit, disk_quota, internal_port, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET php_version = excluded.php_version, cpu_limit = excluded.cpu_limit, memory_limit = excluded.memory_limit, disk_quota = excluded.disk_quota, internal_port = excluded.internal_port, updated_at = excluded.updated_at").bind(id, body.phpVersion, body.cpuLimit, body.memoryLimit, body.diskQuota, body.internalPort, now),
    getD1().prepare("INSERT INTO activity (id, project_id, type, title, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), id, "resource", "Resource project diperbarui", `${user.name} mengatur PHP ${body.phpVersion}, ${body.cpuLimit} vCPU, ${body.memoryLimit} MB memory.`, now),
  ]);
  return NextResponse.json({ resources: { ...body, updatedAt: now } });
}
