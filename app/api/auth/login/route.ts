import { NextResponse } from "next/server";
import { login, sessionCookieName } from "../../_lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { email?: string; password?: string } | null;
  if (!body?.email || !body.password) return NextResponse.json({ error: "Email dan password wajib diisi." }, { status: 400 });
  const result = await login(request, body.email, body.password);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.locked ? 429 : 401 });
  const response = NextResponse.json({ user: result.user });
  response.cookies.set(sessionCookieName, result.token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 7 });
  return response;
}
