import { NextResponse } from "next/server";
import { getD1 } from "@/db/bootstrap";
import { requireUser } from "../../../_lib/auth";
import { syncExecutorDeployment } from "../../../_lib/deployment";

function sanitizeLogForClient(message: string) {
  return message
    .replace(
      /^\[executor:[^\]]+\]\s*/,
      "",
    )
    .replace(
      /\b(authorization)\s*:\s*bearer\s+[^\s,;]+/gi,
      "$1: Bearer [REDACTED]",
    )
    .replace(
      /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
      "Bearer [REDACTED]",
    )
    .replace(
      /\b(APP_KEY|DB_PASSWORD|DB_USERNAME|DATABASE_URL|REDIS_PASSWORD|MAIL_PASSWORD|API_KEY|TOKEN|SECRET|PASSWORD)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/gi,
      "$1=[REDACTED]",
    )
    .replace(
      /("?(?:password|token|secret|api[_-]?key|app[_-]?key|db[_-]?password)"?\s*:\s*)("[^"]*"|'[^']*'|[^,\s}]+)/gi,
      '$1"[REDACTED]"',
    );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireUser(request);

  const { id } = await params;

  await syncExecutorDeployment(id);

  const results = await getD1()
    .prepare(
      `SELECT
        id,
        level,
        message,
        created_at AS createdAt
       FROM deployment_logs
       WHERE deployment_id = ?
       ORDER BY created_at ASC`,
    )
    .bind(id)
    .all();

  const logs =
    (results.results ?? []).map((log) => ({
      ...log,
      message: sanitizeLogForClient(
        String(log.message),
      ),
    }));

  const deployment = await getD1()
    .prepare(
      `SELECT
        status,
        error,
        finished_at AS finishedAt
       FROM deployments
       WHERE id = ?`,
    )
    .bind(id)
    .first();

  return NextResponse.json({
    logs,
    deployment,
  });
}
