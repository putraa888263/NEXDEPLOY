import { NextResponse } from "next/server";
import { getD1 } from "@/db/bootstrap";
import { requireUser } from "../../../_lib/auth";
import { decryptEnvironmentValue } from "../../../_lib/environment";

type ProjectRow = {
  id: string;
  slug: string;
};

type ExecutorRow = {
  url: string;
  token_encrypted: string;
};

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  await requireUser(request);

  const { id } = await params;
  const db = getD1();

  const project = await db
    .prepare(
      `
        SELECT
          id,
          slug
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

    const executorUrl =
      `${executor.url.replace(/\/+$/, "")}` +
      `/projects/${project.id}/runtime/status` +
      `?projectSlug=${encodeURIComponent(project.slug)}`;

    const response = await fetch(
      executorUrl,
      {
        headers: {
          authorization: `Bearer ${token}`,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      },
    );

    const result = (await response
      .json()
      .catch(() => ({}))) as {
      runtime?: unknown;
      error?: string;
    };

    if (
      !response.ok ||
      !result.runtime
    ) {
      return NextResponse.json(
        {
          error:
            result.error ||
            "Runtime project tidak tersedia.",
        },
        {
          status:
            response.status === 404
              ? 404
              : 502,
        },
      );
    }

    return NextResponse.json({
      ok: true,
      runtime: result.runtime,
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "Executor tidak dapat dijangkau.",
      },
      {
        status: 502,
      },
    );
  }
}
