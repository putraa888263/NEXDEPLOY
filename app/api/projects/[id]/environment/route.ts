import { NextResponse } from "next/server";
import { getD1 } from "@/db/bootstrap";
import { decryptEnvironmentValue, encryptEnvironmentValue, isSecretKey } from "../../../_lib/environment";
import { requireUser } from "../../../_lib/auth";

type EnvironmentEntry = { key: string; value: string; isSecret?: boolean };

function defaultEnvironment(project: { name: string; domain: string; database_type: string }) {
  const entries: EnvironmentEntry[] = [
    { key: "APP_NAME", value: project.name }, { key: "APP_ENV", value: "production" }, { key: "APP_DEBUG", value: "false" }, { key: "APP_URL", value: `https://${project.domain}` },
  ];
  if (project.database_type !== "Tanpa database") entries.push({ key: "DB_CONNECTION", value: project.database_type === "PostgreSQL" ? "pgsql" : "mysql" }, { key: "DB_HOST", value: `nexdeploy-${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-db` }, { key: "DB_PORT", value: project.database_type === "PostgreSQL" ? "5432" : "3306" }, { key: "DB_DATABASE", value: "" }, { key: "DB_USERNAME", value: "" }, { key: "DB_PASSWORD", value: "", isSecret: true });
  return entries;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser(request);
  const { id } = await params;
  const project = await getD1().prepare("SELECT name, domain, database_type FROM projects WHERE id = ?").bind(id).first<{ name: string; domain: string; database_type: string }>();
  if (!project) return NextResponse.json({ error: "Project tidak ditemukan." }, { status: 404 });
  const saved = await getD1().prepare("SELECT key, value_encrypted AS valueEncrypted, is_secret AS isSecret, updated_at AS updatedAt FROM project_environment WHERE project_id = ? ORDER BY key").bind(id).all<{ key: string; valueEncrypted: string; isSecret: number; updatedAt: string }>();
  if (!saved.results?.length) return NextResponse.json({ environment: defaultEnvironment(project).map((entry) => ({ key: entry.key, value: entry.value, isSecret: Boolean(entry.isSecret ?? isSecretKey(entry.key)), saved: false })) });
  return NextResponse.json({ environment: await Promise.all(saved.results.map(async (entry) => ({ key: entry.key, value: entry.isSecret ? "" : await decryptEnvironmentValue(entry.valueEncrypted), isSecret: Boolean(entry.isSecret), saved: true, updatedAt: entry.updatedAt }))) });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(request);
  if (user.role === "Viewer") return NextResponse.json({ error: "Role Viewer tidak dapat mengubah environment." }, { status: 403 });
  const { id } = await params;
  const body = await request.json().catch(() => null) as { environment?: EnvironmentEntry[] } | null;
  const entries = body?.environment ?? [];
  if (!Array.isArray(entries) || entries.length > 100 || entries.some((entry) => !/^[A-Z][A-Z0-9_]*$/.test(entry.key) || typeof entry.value !== "string")) return NextResponse.json({ error: "Format environment tidak valid." }, { status: 400 });
  const exists = await getD1().prepare("SELECT id FROM projects WHERE id = ?").bind(id).first();
  if (!exists) return NextResponse.json({ error: "Project tidak ditemukan." }, { status: 404 });
  const required = ["APP_NAME", "APP_ENV", "APP_DEBUG", "APP_URL"];
  const keys = new Set(entries.map((entry) => entry.key));
  if (required.some((key) => !keys.has(key))) return NextResponse.json({ error: "APP_NAME, APP_ENV, APP_DEBUG, dan APP_URL wajib tersedia." }, { status: 400 });
  const now = new Date().toISOString();
  const db = getD1();
  const existing = await db.prepare("SELECT key, value_encrypted AS valueEncrypted, is_secret AS isSecret FROM project_environment WHERE project_id = ?").bind(id).all<{ key: string; valueEncrypted: string; isSecret: number }>();
  const existingByKey = new Map((existing.results ?? []).map((entry) => [entry.key, entry]));
  const statements = [db.prepare("DELETE FROM project_environment WHERE project_id = ?").bind(id)];
  for (const entry of entries) {
    const secret = Boolean(entry.isSecret ?? isSecretKey(entry.key));
    const prior = existingByKey.get(entry.key);
    const encrypted = secret && !entry.value && prior?.isSecret ? prior.valueEncrypted : await encryptEnvironmentValue(entry.value);
    statements.push(db.prepare("INSERT INTO project_environment (id, project_id, key, value_encrypted, is_secret, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), id, entry.key, encrypted, secret ? 1 : 0, now));
  }
  statements.push(db.prepare("INSERT INTO activity (id, project_id, type, title, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), id, "environment", "Environment diperbarui", `${user.name} memperbarui ${entries.length} variable environment.`, now));
  await db.batch(statements);
  return NextResponse.json({ ok: true });
}
