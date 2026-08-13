import { NextResponse } from "next/server";
import { getD1 } from "@/db/bootstrap";
import { requireUser } from "../_lib/auth";

const types = ["deployment", "system", "backup", "account", "environment", "resource"];

export async function GET(request: Request) {
  await requireUser(request);
  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "all";
  const page = Math.max(0, Number(url.searchParams.get("page") ?? "0"));
  if (type !== "all" && !types.includes(type)) return NextResponse.json({ error: "Filter aktivitas tidak valid." }, { status: 400 });
  const limit = 50;
  const query = type === "all"
    ? getD1().prepare("SELECT activity.id, activity.type, activity.title, activity.detail, activity.created_at AS createdAt, projects.name AS projectName FROM activity LEFT JOIN projects ON projects.id = activity.project_id ORDER BY activity.created_at DESC LIMIT ? OFFSET ?").bind(limit, page * limit)
    : getD1().prepare("SELECT activity.id, activity.type, activity.title, activity.detail, activity.created_at AS createdAt, projects.name AS projectName FROM activity LEFT JOIN projects ON projects.id = activity.project_id WHERE activity.type = ? ORDER BY activity.created_at DESC LIMIT ? OFFSET ?").bind(type, limit, page * limit);
  const results = await query.all();
  return NextResponse.json({ activity: results.results ?? [], page, limit });
}
