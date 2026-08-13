import { NextResponse } from "next/server";
import { getD1 } from "@/db/bootstrap";
import { requireUser } from "../../../_lib/auth";
import { syncExecutorDeployment } from "../../../_lib/deployment";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser(request);
  const { id } = await params;
  await syncExecutorDeployment(id);
  const results = await getD1().prepare("SELECT id, level, message, created_at AS createdAt FROM deployment_logs WHERE deployment_id = ? ORDER BY created_at ASC").bind(id).all();
  const logs = (results.results ?? []).map((log) => ({ ...log, message: String(log.message).replace(/^\[executor:[^\]]+\]\s*/, "") }));
  return NextResponse.json({ logs });
}
