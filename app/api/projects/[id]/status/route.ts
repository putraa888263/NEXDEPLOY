import { NextResponse } from "next/server";
import { getD1 } from "@/db/bootstrap";
import { requireUser } from "../../../_lib/auth";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(request);
  if (user.role === "Viewer") return NextResponse.json({ error: "Role Viewer tidak dapat mengubah project." }, { status: 403 });
  const body = await request.json().catch(() => null) as { status?: "Healthy" | "Stopped" } | null;
  if (!body || !["Healthy", "Stopped"].includes(body.status ?? "")) return NextResponse.json({ error: "Status tidak valid." }, { status: 400 });
  const { id } = await params;
  const project = await getD1().prepare("SELECT id, name FROM projects WHERE id = ?").bind(id).first<{ id: string; name: string }>();
  if (!project) return NextResponse.json({ error: "Project tidak ditemukan." }, { status: 404 });
  const now = new Date().toISOString();
  const cpu = body.status === "Stopped" ? 0 : 7;
  const memory = body.status === "Stopped" ? 0 : 26;
  await getD1().batch([
    getD1().prepare("UPDATE projects SET status = ?, cpu = ?, memory = ?, updated_at = ? WHERE id = ?").bind(body.status, cpu, memory, now, id),
    getD1().prepare("INSERT INTO activity (id, project_id, type, title, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), id, "system", body.status === "Stopped" ? "Project dihentikan" : "Project dijalankan", `${project.name} diubah oleh ${user.name}.`, now),
  ]);
  return NextResponse.json({ status: body.status, cpu, memory, updatedAt: now });
}
