import { NextResponse } from "next/server";
import { getD1 } from "@/db/bootstrap";
import { requireUser } from "../_lib/auth";

const colors = ["#2563eb", "#db2777", "#7c3aed", "#0891b2", "#16a34a", "#ea580c"];
const databases = ["MariaDB", "PostgreSQL", "Tanpa database"];
const frameworks = ["Laravel", "PHP Native"];

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export async function GET(request: Request) {
  await requireUser(request);
  const results = await getD1().prepare("SELECT id, name, slug, domain, framework, database_type AS database, version, status, cpu, memory, color, archive_name AS archiveName, archive_size AS archiveSize, archive_validation AS archiveValidation, updated_at AS updatedAt FROM projects ORDER BY created_at DESC").all();
  return NextResponse.json({ projects: results.results ?? [] });
}

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user.role === "Viewer") return NextResponse.json({ error: "Role Viewer tidak dapat membuat project." }, { status: 403 });
  const body = await request.json().catch(() => null) as { name?: string; framework?: string; database?: string } | null;
  const name = body?.name?.trim() ?? "";
  const framework = body?.framework ?? "";
  const database = body?.database ?? "";
  if (!name || !frameworks.includes(framework) || !databases.includes(database)) return NextResponse.json({ error: "Data project tidak valid." }, { status: 400 });
  const baseSlug = slugify(name);
  if (!baseSlug) return NextResponse.json({ error: "Nama project harus memuat huruf atau angka." }, { status: 400 });
  const settings = await getD1().prepare("SELECT base_domain FROM settings WHERE id = 1").first<{ base_domain: string }>();
  let slug = baseSlug;
  let suffix = 2;
  while (await getD1().prepare("SELECT id FROM projects WHERE slug = ?").bind(slug).first()) slug = `${baseSlug}-${suffix++}`;
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const project = { id, name, slug, domain: `${slug}.${settings?.base_domain ?? "localhost"}`, framework, database, version: "v1.0.0", status: "Stopped", cpu: 0, memory: 0, color: colors[Math.floor(Math.random() * colors.length)], updatedAt: now };
  await getD1().batch([
    getD1().prepare("INSERT INTO projects (id, name, slug, domain, framework, database_type, version, status, cpu, memory, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, name, slug, project.domain, framework, database, project.version, project.status, project.cpu, project.memory, project.color, now, now),
    getD1().prepare("INSERT INTO activity (id, project_id, type, title, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), id, "deployment", "Project dibuat", `${name} menunggu file ZIP untuk deployment.`, now),
  ]);
  return NextResponse.json({ project }, { status: 201 });
}
