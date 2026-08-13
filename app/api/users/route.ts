import { NextResponse } from "next/server";
import { createPasswordHash, requireUser, type PanelRole } from "../_lib/auth";
import { getD1 } from "@/db/bootstrap";

const roles: PanelRole[] = ["Administrator", "Operator", "Viewer"];

async function requireAdministrator(request: Request) {
  const user = await requireUser(request);
  if (user.role !== "Administrator") throw new Response(JSON.stringify({ error: "Hanya Administrator yang dapat mengelola pengguna." }), { status: 403, headers: { "content-type": "application/json" } });
  return user;
}

export async function GET(request: Request) {
  await requireAdministrator(request);
  const results = await getD1().prepare("SELECT id, name, email, role, status, last_login_at AS lastLoginAt, created_at AS createdAt FROM users ORDER BY created_at ASC").all();
  return NextResponse.json({ users: results.results ?? [] });
}

export async function POST(request: Request) {
  const administrator = await requireAdministrator(request);
  const body = await request.json().catch(() => null) as { name?: string; email?: string; password?: string; role?: PanelRole } | null;
  const name = body?.name?.trim() ?? "";
  const email = body?.email?.trim().toLowerCase() ?? "";
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || !body?.password || body.password.length < 8 || !body.role || !roles.includes(body.role)) return NextResponse.json({ error: "Nama, email, role, dan password minimal 8 karakter wajib valid." }, { status: 400 });
  const exists = await getD1().prepare("SELECT id FROM users WHERE lower(email) = lower(?)").bind(email).first();
  if (exists) return NextResponse.json({ error: "Email tersebut sudah digunakan." }, { status: 409 });
  const now = new Date().toISOString();
  const user = { id: crypto.randomUUID(), name, email, role: body.role, status: "Active", lastLoginAt: null, createdAt: now };
  await getD1().batch([
    getD1().prepare("INSERT INTO users (id, name, email, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(user.id, name, email, await createPasswordHash(body.password), user.role, user.status, now),
    getD1().prepare("INSERT INTO activity (id, project_id, type, title, detail, created_at) VALUES (?, NULL, ?, ?, ?, ?)").bind(crypto.randomUUID(), "account", "Pengguna dibuat", `${administrator.name} membuat akun ${email} sebagai ${user.role}.`, now),
  ]);
  return NextResponse.json({ user }, { status: 201 });
}
