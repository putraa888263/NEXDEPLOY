import { NextResponse } from "next/server";
import { requireUser, type PanelRole } from "../../_lib/auth";
import { getD1 } from "@/db/bootstrap";

const roles: PanelRole[] = ["Administrator", "Operator", "Viewer"];

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const administrator = await requireUser(request);
  if (administrator.role !== "Administrator") return NextResponse.json({ error: "Hanya Administrator yang dapat mengelola pengguna." }, { status: 403 });
  const { id } = await params;
  if (id === administrator.id) return NextResponse.json({ error: "Ubah role atau status akun sendiri melalui akun Administrator lain." }, { status: 400 });
  const body = await request.json().catch(() => null) as { role?: PanelRole; status?: "Active" | "Disabled" } | null;
  if (!body || (body.role === undefined && body.status === undefined) || (body.role !== undefined && !roles.includes(body.role)) || (body.status !== undefined && !["Active", "Disabled"].includes(body.status))) return NextResponse.json({ error: "Perubahan pengguna tidak valid." }, { status: 400 });
  const target = await getD1().prepare("SELECT id, name, email, role, status FROM users WHERE id = ?").bind(id).first<{ id: string; name: string; email: string; role: PanelRole; status: "Active" | "Disabled" }>();
  if (!target) return NextResponse.json({ error: "Pengguna tidak ditemukan." }, { status: 404 });
  const nextRole = body.role ?? target.role;
  const nextStatus = body.status ?? target.status;
  if (target.role === "Administrator" && target.status === "Active" && (nextRole !== "Administrator" || nextStatus !== "Active")) {
    const admins = await getD1().prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'Administrator' AND status = 'Active'").first<{ count: number }>();
    if ((admins?.count ?? 0) <= 1) return NextResponse.json({ error: "Administrator aktif terakhir tidak dapat diubah atau dinonaktifkan." }, { status: 400 });
  }
  const now = new Date().toISOString();
  await getD1().batch([
    getD1().prepare("UPDATE users SET role = ?, status = ? WHERE id = ?").bind(nextRole, nextStatus, id),
    ...(nextStatus === "Disabled" ? [getD1().prepare("DELETE FROM sessions WHERE user_id = ?").bind(id)] : []),
    getD1().prepare("INSERT INTO activity (id, project_id, type, title, detail, created_at) VALUES (?, NULL, ?, ?, ?, ?)").bind(crypto.randomUUID(), "account", "Pengguna diperbarui", `${administrator.name} mengubah ${target.email} menjadi ${nextRole} (${nextStatus}).`, now),
  ]);
  return NextResponse.json({ user: { ...target, role: nextRole, status: nextStatus } });
}
