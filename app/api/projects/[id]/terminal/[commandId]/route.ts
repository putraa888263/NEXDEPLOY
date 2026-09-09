import { NextResponse } from "next/server";
import { getD1 } from "@/db/bootstrap";
import { requireUser } from "../../../../_lib/auth";
import { decryptEnvironmentValue } from "../../../../_lib/environment";

type ExecutorRow = {
  url: string;
  token_encrypted: string;
};

type ExecutorTerminalResult = {
  ok?: boolean;
  projectId?: string;
  id?: string;
  projectSlug?: string;
  command?: string;
  status?: string;
  output?: string;
  outputTruncated?: boolean;
  startedAt?: string | null;
  finishedAt?: string | null;
  exitCode?: number | null;
  error?: string;
};

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
      commandId: string;
    }>;
  },
) {
  await requireUser(request);

  const { id, commandId } = await params;

  if (!commandId.trim()) {
    return NextResponse.json(
      {
        error: "Command ID wajib diisi.",
      },
      {
        status: 400,
      },
    );
  }

  const db = getD1();

  const executor = await db
    .prepare(
      `
        SELECT
          url,
          token_encrypted
        FROM executor_settings
        WHERE id = 1
      `,
    )
    .first<ExecutorRow>();

  if (!executor) {
    return NextResponse.json(
      {
        error: "Executor belum dikonfigurasi.",
      },
      {
        status: 503,
      },
    );
  }

  try {
    const token = await decryptEnvironmentValue(
      executor.token_encrypted,
    );

    const executorUrl = new URL(
      `${executor.url.replace(/\/+$/, "")}/projects/${id}/terminal/${encodeURIComponent(commandId)}`,
    );

    const executorResponse = await fetch(
      executorUrl,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      },
    );

    const result =
      (await executorResponse
        .json()
        .catch(() => ({}))) as ExecutorTerminalResult;

    if (
      !executorResponse.ok ||
      !result.ok
    ) {
      return NextResponse.json(
        {
          error:
            result.error ||
            "Status terminal gagal dibaca.",
        },
        {
          status: executorResponse.status,
        },
      );
    }

    return NextResponse.json({
      ok: true,
      projectId: id,
      id: result.id,
      projectSlug: result.projectSlug,
      command: result.command,
      status: result.status,
      output: result.output || "",
      outputTruncated:
        result.outputTruncated || false,
      startedAt: result.startedAt || null,
      finishedAt: result.finishedAt || null,
      exitCode:
        result.exitCode ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Executor tidak dapat dijangkau.",
      },
      {
        status: 502,
      },
    );
  }
}
