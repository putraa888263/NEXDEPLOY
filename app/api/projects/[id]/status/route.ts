import { NextResponse } from "next/server";
import { getD1 } from "@/db/bootstrap";
import { requireUser } from "../../../_lib/auth";
import { decryptEnvironmentValue } from "../../../_lib/environment";

type ProjectStatus =
  | "Healthy"
  | "Stopped";

type ProjectRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
};

type ExecutorRow = {
  url: string;
  token_encrypted: string;
};

export async function PATCH(
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

  if (
    user.role === "Viewer"
  ) {
    return NextResponse.json(
      {
        error:
          "Role Viewer tidak dapat mengubah project.",
      },
      {
        status: 403,
      },
    );
  }

  const body =
    await request
      .json()
      .catch(() => null) as {
        status?: ProjectStatus;
      } | null;

  if (
    !body ||
    ![
      "Healthy",
      "Stopped",
    ].includes(
      body.status ?? "",
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Status tidak valid.",
      },
      {
        status: 400,
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
            slug,
            status
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

  /*
   * Jangan izinkan runtime berubah saat deployment
   * masih dapat memodifikasi container project.
   */
  const activeDeployment =
    await db
      .prepare(
        `
          SELECT id
          FROM deployments
          WHERE project_id = ?
            AND status IN (
              'Queued',
              'Running',
              'WaitingExecutor'
            )
          LIMIT 1
        `,
      )
      .bind(id)
      .first();

  if (activeDeployment) {
    return NextResponse.json(
      {
        error:
          "Project sedang memiliki deployment aktif. Tunggu deployment selesai.",
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

  const action =
    body.status === "Stopped"
      ? "stop"
      : "start";

  try {
    const token =
      await decryptEnvironmentValue(
        executor.token_encrypted,
      );

    const response =
      await fetch(
        `${executor.url.replace(/\/+$/, "")}/projects/${project.id}/runtime/${action}`,
        {
          method: "POST",
          headers: {
            authorization:
              `Bearer ${token}`,
            "content-type":
              "application/json",
          },
          body:
            JSON.stringify({
              projectSlug:
                project.slug,
            }),
          signal:
            AbortSignal.timeout(
              60000,
            ),
        },
      );

    const result =
      await response
        .json()
        .catch(() => ({})) as {
          error?: string;
          runtime?: {
            status?: ProjectStatus;
          };
        };

    if (
      !response.ok ||
      result.runtime?.status !==
        body.status
    ) {
      return NextResponse.json(
        {
          error:
            result.error ||
            "Executor gagal mengubah runtime project.",
        },
        {
          status: 502,
        },
      );
    }
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

  /*
   * Metadata panel hanya berubah SETELAH runtime
   * nyata sukses.
   */
  const now =
    new Date().toISOString();

  const cpu =
    body.status === "Stopped"
      ? 0
      : null;

  const memory =
    body.status === "Stopped"
      ? 0
      : null;

  if (
    body.status === "Stopped"
  ) {
    await db.batch([
      db
        .prepare(
          `
            UPDATE projects
            SET
              status = ?,
              cpu = 0,
              memory = 0,
              updated_at = ?
            WHERE id = ?
          `,
        )
        .bind(
          body.status,
          now,
          id,
        ),

      db
        .prepare(
          `
            INSERT INTO activity (
              id,
              project_id,
              type,
              title,
              detail,
              created_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
          `,
        )
        .bind(
          crypto.randomUUID(),
          id,
          "system",
          "Project dihentikan",
          `${project.name} dihentikan oleh ${user.name}.`,
          now,
        ),
    ]);
  } else {
    await db.batch([
      db
        .prepare(
          `
            UPDATE projects
            SET
              status = ?,
              updated_at = ?
            WHERE id = ?
          `,
        )
        .bind(
          body.status,
          now,
          id,
        ),

      db
        .prepare(
          `
            INSERT INTO activity (
              id,
              project_id,
              type,
              title,
              detail,
              created_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
          `,
        )
        .bind(
          crypto.randomUUID(),
          id,
          "system",
          "Project dijalankan",
          `${project.name} dijalankan oleh ${user.name}.`,
          now,
        ),
    ]);
  }

  return NextResponse.json({
    status:
      body.status,
    ...(cpu !== null
      ? {
          cpu,
        }
      : {}),
    ...(memory !== null
      ? {
          memory,
        }
      : {}),
    updatedAt:
      now,
  });
}
