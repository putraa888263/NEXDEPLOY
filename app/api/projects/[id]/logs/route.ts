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

type ExecutorLogsResult = {
  ok?: boolean;
  projectId?: string;
  service?: string;
  container?: string;
  running?: boolean;
  tail?: number;
  logs?: string;
  error?: string;
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

  const { id } =
    await params;

  const url =
    new URL(request.url);

  const service =
    url.searchParams.get("service") ||
    "app";

  if (
    ![
      "app",
      "worker",
      "scheduler",
    ].includes(service)
  ) {
    return NextResponse.json(
      {
        error:
          "Service log tidak valid.",
      },
      {
        status: 400,
      },
    );
  }

  const requestedTail =
    Number(
      url.searchParams.get("tail") ||
      "200",
    );

  const tail =
    Number.isFinite(requestedTail)
      ? Math.min(
          500,
          Math.max(
            20,
            Math.trunc(
              requestedTail,
            ),
          ),
        )
      : 200;

  const db =
    getD1();

  const project =
    await db
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
        error:
          "Project tidak ditemukan.",
      },
      {
        status: 404,
      },
    );
  }

  const executor =
    await db
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
        error:
          "Executor belum dikonfigurasi.",
      },
      {
        status: 503,
      },
    );
  }

  try {
    const token =
      await decryptEnvironmentValue(
        executor.token_encrypted,
      );

    const executorUrl =
      new URL(
        `${executor.url}/projects/${id}/logs`,
      );

    executorUrl.searchParams.set(
      "projectSlug",
      project.slug,
    );

    executorUrl.searchParams.set(
      "service",
      service,
    );

    executorUrl.searchParams.set(
      "tail",
      String(tail),
    );

    const executorResponse =
      await fetch(
        executorUrl,
        {
          method: "GET",
          headers: {
            Authorization:
              `Bearer ${token}`,
          },
          cache:
            "no-store",
        },
      );

    const result =
      await executorResponse
        .json() as ExecutorLogsResult;

    if (
      !executorResponse.ok ||
      !result.ok
    ) {
      return NextResponse.json(
        {
          error:
            result.error ||
            "Log container gagal dibaca.",
        },
        {
          status:
            executorResponse.status,
        },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        service:
          result.service,
        container:
          result.container,
        running:
          result.running,
        tail:
          result.tail,
        logs:
          result.logs || "",
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Log container gagal dibaca.",
      },
      {
        status: 502,
      },
    );
  }
}
