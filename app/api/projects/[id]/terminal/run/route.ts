import { NextResponse } from "next/server";
import { getD1 } from "@/db/bootstrap";
import { requireUser } from "../../../../_lib/auth";
import { decryptEnvironmentValue } from "../../../../_lib/environment";

type ProjectRow = {
  id: string;
  slug: string;
};

type ExecutorRow = {
  url: string;
  token_encrypted: string;
};

type ExecutorTerminalResult = {
  ok?: boolean;
  projectId?: string;
  projectSlug?: string;
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
    }>;
  },
) {
  await requireUser(request);

  const { id } = await params;

  let payload: {
    projectSlug?: unknown;
    command?: unknown;
  };

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: "Body request tidak valid.",
      },
      {
        status: 400,
      },
    );
  }

  if (
    typeof payload.projectSlug !== "string" ||
    !payload.projectSlug.trim()
  ) {
    return NextResponse.json(
      {
        error: "Project slug wajib diisi.",
      },
      {
        status: 400,
      },
    );
  }

  if (
    typeof payload.command !== "string" ||
    !payload.command.trim()
  ) {
    return NextResponse.json(
      {
        error: "Command wajib diisi.",
      },
      {
        status: 400,
      },
    );
  }

  const command = payload.command.trim();

  if (command.length > 4000) {
    return NextResponse.json(
      {
        error: "Command terlalu panjang. Maksimal 4000 karakter.",
      },
      {
        status: 400,
      },
    );
  }

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

  if (project.slug !== payload.projectSlug.trim()) {
    return NextResponse.json(
      {
        error: "Project slug tidak sesuai.",
      },
      {
        status: 400,
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
      `${executor.url.replace(/\/+$/, "")}/projects/${id}/terminal/run`,
    );

    const executorResponse = await fetch(
      executorUrl,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          projectSlug: project.slug,
          command,
        }),
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
            "Command terminal gagal dijalankan.",
        },
        {
          status: executorResponse.status,
        },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        projectId: project.id,
        projectSlug: project.slug,
        id: result.id,
        status: result.status,
      },
      {
        status: 202,
      },
    );
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
