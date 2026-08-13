import { NextResponse } from "next/server";
import { changePassword, sessionCookieName } from "../../_lib/auth";

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null) as { currentPassword?: string; newPassword?: string } | null;
  if (!body?.currentPassword || !body.newPassword) return NextResponse.json({ error: "Password lama dan baru wajib diisi." }, { status: 400 });
  if (body.newPassword.length < 8) return NextResponse.json({ error: "Password baru minimal 8 karakter." }, { status: 400 });
  if (body.currentPassword === body.newPassword) return NextResponse.json({ error: "Gunakan password baru yang berbeda." }, { status: 400 });
  const result = await changePassword(request, body.currentPassword, body.newPassword);
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookieName, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
