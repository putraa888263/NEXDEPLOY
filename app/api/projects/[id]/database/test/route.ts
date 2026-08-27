import { NextResponse } from "next/server";
import { getD1 } from "@/db/bootstrap";
import { requireUser } from "../../../../_lib/auth";
import { decryptEnvironmentValue } from "../../../../_lib/environment";

type ProjectRow = {
  id: string;
  name: string;
  databaseType: string | null;
};

type ExecutorRow = {
  url: string;
  token_encrypted: string;
};

type ConnectionResult = {
  ok?: boolean;
  connection?: {
    databaseType?: string;
    database?: string;
    host?: string;
    port?: number;
    latencyMs?: number;
  };
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
  const user =
    await requireUser(request);

  if (user.role === "Viewer") {
    return NextResponse.json(
      {
        error:
          "Role Viewer tidak dapat menguji koneksi database.",
      },
      {
        status: 403,
      },
    );
  }

  const { id } =
    await params;

  const db =
    getD1();

  const project =
    await db
      .prepare(
        `
          SELECT
            id,
            name,
            database_type AS databaseType
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

  if (
    ![
      "MariaDB",
      "PostgreSQL",
    ].includes(
      project.databaseType || "",
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Project ini tidak menggunakan database yang dapat diuji.",
      },
      {
        status: 409,
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

    const executorResponse =
      await fetch(
        `${executor.url}/projects/${id}/database/test`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            Authorization:
              `Bearer ${token}`,
          },
          body:
            JSON.stringify({
              databaseType:
                project.databaseType,
            }),
          cache:
            "no-store",
        },
      );

    const result =
      await executorResponse
        .json() as ConnectionResult;

    if (
      !executorResponse.ok ||
      !result.ok ||
      !result.connection
    ) {
      return NextResponse.json(
        {
          error:
            result.error ||
            "Test koneksi database gagal.",
        },
        {
          status:
            executorResponse.ok
              ? 502
              : executorResponse.status,
        },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        connection:
          result.connection,
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Test koneksi database gagal.",
      },
      {
        status: 502,
      },
    );
  }
}
