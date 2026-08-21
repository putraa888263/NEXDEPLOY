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

function hasFinalLog(
  logs: Array<{ message: unknown }>,
  status?: string,
) {
  if (status === "Succeeded") {
    return logs.some((log) =>
      /\[(NPM|NPM_START|NPM_SKIP|NPM_ERROR)\]/.test(
        String(log.message),
      ),
    );
  }

  return logs.some((log) =>
    /\[FAILURE\]|Deployment gagal pada tahap/.test(
      String(log.message),
    ),
  );
}

async function readDeploymentLogs(id: string) {
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

  return results.results ?? [];
}

async function readDeployment(id: string) {
  return await getD1()
    .prepare(
      `SELECT
        status,
        error,
        finished_at AS finishedAt
       FROM deployments
       WHERE id = ?`,
    )
    .bind(id)
    .first<{
      status?: string;
      error?: string | null;
      finishedAt?: string | null;
    }>();
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireUser(request);

  const { id } = await params;

  let rows: Array<{ message: unknown }> = [];
  let deployment:
    Awaited<ReturnType<typeof readDeployment>> =
      null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await syncExecutorDeployment(id);

    rows = await readDeploymentLogs(id);
    deployment = await readDeployment(id);

    const terminalStatus =
      deployment?.status === "Succeeded" ||
      deployment?.status === "Failed";

    if (
      !terminalStatus ||
      hasFinalLog(rows, deployment?.status) ||
      attempt === 2
    ) {
      break;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, 600),
    );
  }

  const logs =
    rows.map((log) => ({
      ...log,
      message: sanitizeLogForClient(
        String(log.message),
      ),
    }));

  return NextResponse.json({
    logs,
    deployment,
  });
}
