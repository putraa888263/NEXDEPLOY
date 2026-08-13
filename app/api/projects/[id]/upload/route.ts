import { NextResponse } from "next/server";
import { getD1, getUploads } from "@/db/bootstrap";
import { requireUser } from "../../../_lib/auth";
import { inspectApplicationArchive } from "../../../_lib/zip";

const maxArchiveSize = 100 * 1024 * 1024;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(request);
  if (user.role === "Viewer") return NextResponse.json({ error: "Role Viewer tidak dapat mengunggah aplikasi." }, { status: 403 });
  const { id } = await params;
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) return NextResponse.json({ error: "Pilih file ZIP aplikasi." }, { status: 400 });
  const form = await request.formData();
  const archive = form.get("archive");
  // `File` is not exposed as a runtime global in every local Workers adapter.
  if (typeof archive === "string" || !archive || !archive.name.toLowerCase().endsWith(".zip")) return NextResponse.json({ error: "Pilih file ZIP aplikasi." }, { status: 400 });
  if (!archive.size || archive.size > maxArchiveSize) return NextResponse.json({ error: "Ukuran ZIP harus antara 1 byte dan 100 MB pada panel lokal." }, { status: 400 });
  const project = await getD1().prepare("SELECT id, name, slug, framework FROM projects WHERE id = ?").bind(id).first<{ id: string; name: string; slug: string; framework: string }>();
  if (!project) return NextResponse.json({ error: "Project tidak ditemukan." }, { status: 404 });
  const archiveBytes = await archive.arrayBuffer();
  let validation: Awaited<ReturnType<typeof inspectApplicationArchive>>;
  try { validation = await inspectApplicationArchive(archiveBytes, project.framework); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "ZIP tidak dapat diperiksa." }, { status: 400 }); }
  const safeName = archive.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const key = `projects/${project.id}/${Date.now()}-${safeName}`;
  try { await getUploads().put(key, new Uint8Array(archiveBytes), { httpMetadata: { contentType: "application/zip" }, customMetadata: { projectId: project.id, uploadedBy: user.id } }); }
  catch (error) {
    console.error("Gagal menyimpan ZIP ke R2 lokal", error);
    const reason = error instanceof Error && error.message ? ` (${error.message})` : "";
    return NextResponse.json({ error: `ZIP lolos validasi, tetapi penyimpanan lokal tidak merespons${reason}. Jalankan ulang panel lalu coba lagi.` }, { status: 503 });
  }
  const now = new Date().toISOString();
  await getD1().batch([
    getD1().prepare("UPDATE projects SET archive_key = ?, archive_name = ?, archive_size = ?, archive_validation = ?, updated_at = ? WHERE id = ?").bind(key, archive.name, archive.size, JSON.stringify(validation), now, project.id),
    getD1().prepare("INSERT INTO activity (id, project_id, type, title, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), project.id, "deployment", "ZIP aplikasi tervalidasi", `${archive.name} memuat ${validation.files} file dan siap diproses oleh worker deployment.`, now),
  ]);
  return NextResponse.json({ archive: { name: archive.name, size: archive.size, ...validation } }, { status: 201 });
}
