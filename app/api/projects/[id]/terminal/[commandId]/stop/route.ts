import { NextResponse } from "next/server";
import { getD1 } from "@/db/bootstrap";
import { requireUser } from "../../../../../_lib/auth";
import { decryptEnvironmentValue } from "../../../../../_lib/environment";

type ProjectRow = {
  id: string;
};

type ExecutorRow = {
  url: string;
  token_encrypted: string;
};

type ExecutorTerminalResult = {
  ok?: boolean;
  projectId?: string;
  id?: string;
  status?: string;
  error?: string;
};

export async function POST(
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

  const db = getD1();

  const project = await db
    .prepare(
      `
        SELECT
          id
        FROM projects
        WHERE id = ?
      `,
    )
    .bind(id)
    .first<ProjectRow>();

  if (!project) {
    return NextResponse.json(
      {
        error: "Project tidak ditemukan.",
      },
      {
        status: 404,
      },
    );
  }

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
      `${executor.url.replace(/\/+$/, "")}/projects/${id}/terminal/${encodeURIComponent(commandId)}/stop`,
    );

    const executorResponse = await fetch(
      executorUrl,
      {
        method: "POST",
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
            "Command terminal gagal dihentikan.",
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
      status: result.status,
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
