import { NextResponse } from "next/server";
import { clearSession, sessionCookieName } from "../../_lib/auth";

export async function POST(request: Request) {
  await clearSession(request);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookieName, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
