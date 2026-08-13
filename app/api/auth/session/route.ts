import { NextResponse } from "next/server";
import { currentUser } from "../../_lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return NextResponse.json({ error: "Belum masuk." }, { status: 401 });
  return NextResponse.json({ user });
}
