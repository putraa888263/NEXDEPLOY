import { NextResponse } from "next/server";
import { getD1 } from "@/db/bootstrap";
import { decryptEnvironmentValue, encryptEnvironmentValue } from "../_lib/environment";
import { requireUser } from "../_lib/auth";

type ExecutorRow = { url: string; token_encrypted: string; updated_at: string };

export async function GET(request: Request) {
  await requireUser(request);
  const row = await getD1().prepare("SELECT url, token_encrypted, updated_at FROM executor_settings WHERE id = 1").first<ExecutorRow>();
  return NextResponse.json({ executor: row ? { url: row.url, configured: true, updatedAt: row.updated_at } : { url: "http://127.0.0.1:8787", configured: false, updatedAt: null } });
}

export async function PUT(request: Request) {
  const user = await requireUser(request);
  if (user.role !== "Administrator") return NextResponse.json({ error: "Hanya Administrator yang dapat mengatur executor." }, { status: 403 });
  const body = await request.json().catch(() => null) as { url?: string; token?: string } | null;
  const url = body?.url?.trim().replace(/\/$/, "");
  if (!url || !/^https?:\/\//.test(url)) return NextResponse.json({ error: "URL executor harus diawali http:// atau https://." }, { status: 400 });
  const existing = await getD1().prepare("SELECT token_encrypted FROM executor_settings WHERE id = 1").first<{ token_encrypted: string }>();
  if (!body?.token && !existing) return NextResponse.json({ error: "Token executor wajib diisi saat konfigurasi pertama." }, { status: 400 });
  const encryptedToken = body?.token ? await encryptEnvironmentValue(body.token) : existing?.token_encrypted;
  const now = new Date().toISOString();
  await getD1().prepare("INSERT INTO executor_settings (id, url, token_encrypted, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET url=excluded.url, token_encrypted=excluded.token_encrypted, updated_at=excluded.updated_at").bind(url, encryptedToken, now).run();
  return NextResponse.json({ executor: { url, configured: true, updatedAt: now } });
}

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user.role !== "Administrator") return NextResponse.json({ error: "Hanya Administrator yang dapat menguji executor." }, { status: 403 });
  const row = await getD1().prepare("SELECT url, token_encrypted FROM executor_settings WHERE id = 1").first<ExecutorRow>();
  if (!row) return NextResponse.json({ error: "Simpan konfigurasi executor terlebih dahulu." }, { status: 400 });
  try {
    const response = await fetch(`${row.url}/health`, { headers: { authorization: `Bearer ${await decryptEnvironmentValue(row.token_encrypted)}` } });
    const health = await response.json().catch(() => ({}));
    if (!response.ok || !health.ok) return NextResponse.json({ error: "Executor merespons tidak sehat." }, { status: 502 });
    return NextResponse.json({ ok: true, health });
  } catch {
    return NextResponse.json({ error: "Executor tidak dapat dijangkau dari panel." }, { status: 502 });
  }
}
