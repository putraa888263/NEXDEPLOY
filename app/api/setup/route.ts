import { NextResponse } from "next/server";
import { createPasswordHash } from "../_lib/auth";
import { ensureDatabase, getD1 } from "@/db/bootstrap";

async function needsSetup() {
  await ensureDatabase();
  const row = await getD1().prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
  return !row?.count;
}

export async function GET() {
  return NextResponse.json({ needsSetup: await needsSetup() });
}

export async function POST(request: Request) {
  if (!(await needsSetup())) return NextResponse.json({ error: "Instalasi awal sudah selesai." }, { status: 409 });
  const body = await request.json().catch(() => null) as { name?: string; email?: string; password?: string } | null;
  const name = body?.name?.trim();
  const email = body?.email?.trim().toLowerCase();
  if (!name || !email || !/^\S+@\S+\.\S+$/.test(email) || !body?.password || body.password.length < 8) return NextResponse.json({ error: "Isi nama, email valid, dan password minimal 8 karakter." }, { status: 400 });
  await getD1().prepare("INSERT INTO users (id, name, email, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, 'Administrator', 'Active', ?)")
    .bind(crypto.randomUUID(), name, email, await createPasswordHash(body.password), new Date().toISOString()).run();
  return NextResponse.json({ ok: true }, { status: 201 });
}
