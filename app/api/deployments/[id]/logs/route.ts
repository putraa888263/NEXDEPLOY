import { NextResponse } from "next/server";
import { getD1 } from "@/db/bootstrap";
import { requireUser } from "../../../_lib/auth";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser(request);
  const { id } = await params;
  const results = await getD1().prepare("SELECT id, level, message, created_at AS createdAt FROM deployment_logs WHERE deployment_id = ? ORDER BY created_at ASC").bind(id).all();
  return NextResponse.json({ logs: results.results ?? [] });
}
