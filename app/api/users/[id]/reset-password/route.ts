import { NextResponse } from "next/server";
import { createPasswordHash, requireUser } from "../../../_lib/auth";
import { getD1 } from "@/db/bootstrap";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const administrator = await requireUser(request);
  if (administrator.role !== "Administrator") return NextResponse.json({ error: "Hanya Administrator yang dapat mengatur ulang password." }, { status: 403 });
  const body = await request.json().catch(() => null) as { password?: string } | null;
  if (!body?.password || body.password.length < 8) return NextResponse.json({ error: "Password sementara minimal 8 karakter." }, { status: 400 });
  const { id } = await params;
  const target = await getD1().prepare("SELECT email FROM users WHERE id = ?").bind(id).first<{ email: string }>();
  if (!target) return NextResponse.json({ error: "Pengguna tidak ditemukan." }, { status: 404 });
  const now = new Date().toISOString();
  await getD1().batch([
    getD1().prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await createPasswordHash(body.password), id),
    getD1().prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
    getD1().prepare("INSERT INTO activity (id, project_id, type, title, detail, created_at) VALUES (?, NULL, ?, ?, ?, ?)").bind(crypto.randomUUID(), "account", "Password pengguna direset", `${administrator.name} mereset password ${target.email}.`, now),
  ]);
  return NextResponse.json({ ok: true });
}
