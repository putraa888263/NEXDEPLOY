import { NextResponse } from "next/server";
import { getD1 } from "@/db/bootstrap";
import { requireUser } from "../_lib/auth";

const fields = ["serverName", "serverIp", "location", "projectDirectory", "baseDomain", "npmUrl", "sslEmail", "defaultDatabase", "databaseVersion", "backupRetention"] as const;

export async function GET(request: Request) {
  await requireUser(request);
  const row = await getD1().prepare("SELECT server_name AS serverName, server_ip AS serverIp, location, project_directory AS projectDirectory, base_domain AS baseDomain, npm_url AS npmUrl, ssl_email AS sslEmail, default_database AS defaultDatabase, database_version AS databaseVersion, backup_retention AS backupRetention FROM settings WHERE id = 1").first();
  return NextResponse.json({ settings: row });
}

export async function PUT(request: Request) {
  const user = await requireUser(request);
  if (user.role !== "Administrator") return NextResponse.json({ error: "Hanya Administrator yang dapat mengubah pengaturan." }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || fields.some((field) => body[field] === undefined)) return NextResponse.json({ error: "Data pengaturan belum lengkap." }, { status: 400 });
  const now = new Date().toISOString();
  await getD1().prepare("UPDATE settings SET server_name=?, server_ip=?, location=?, project_directory=?, base_domain=?, npm_url=?, ssl_email=?, default_database=?, database_version=?, backup_retention=?, updated_at=? WHERE id=1")
    .bind(...fields.map((field) => body[field]), now).run();
  return NextResponse.json({ ok: true });
}
