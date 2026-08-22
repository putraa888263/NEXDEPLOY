import {
  NextResponse,
} from "next/server";

import {
  getD1,
  getUploads,
} from "@/db/bootstrap";

import {
  requireUser,
} from "../../_lib/auth";

import {
  decryptEnvironmentValue,
} from "../../_lib/environment";

import {
  deleteNpmProxyHost,
} from "../../_lib/npm";

type DatabaseType =
  | "MariaDB"
  | "PostgreSQL"
  | "Tanpa database";

async function deleteProjectArtifacts(
  projectId: string,
) {
  const bucket =
    getUploads();

  const prefix =
    `projects/${projectId}/`;

  let cursor:
    | string
    | undefined;

  let deleted = 0;

  do {
    const result =
      await bucket.list({
        prefix,
        cursor,
      });

    const keys =
      result.objects.map(
        (object) =>
          object.key,
      );

    if (keys.length > 0) {
      await bucket.delete(
        keys,
      );

      deleted +=
        keys.length;
    }

    cursor =
      result.truncated
        ? result.cursor
        : undefined;
  } while (cursor);

  return deleted;
}

export async function DELETE(
  request: Request,
  {
    params,
  }: {
    params:
      Promise<{
        id: string;
      }>;
  },
) {
  const user =
    await requireUser(
      request,
    );

  if (
    user.role !==
    "Administrator"
  ) {
    return NextResponse.json(
      {
        error:
          "Hanya Administrator yang dapat menghapus project permanen.",
      },
      {
        status: 403,
      },
    );
  }

  const {
    id,
  } =
    await params;

  const db =
    getD1();

  const project =
    await db
      .prepare(
        `SELECT
           id,
           name,
           slug,
           domain,
           database_type AS database
         FROM projects
         WHERE id = ?`,
      )
      .bind(
        id,
      )
      .first<{
        id: string;
        name: string;
        slug: string;
        domain: string;
        database: DatabaseType;
      }>();

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

  const running =
    await db
      .prepare(
        `SELECT id
         FROM deployments
         WHERE project_id = ?
         AND status IN ('Queued', 'Running')
         LIMIT 1`,
      )
      .bind(
        project.id,
      )
      .first();

  if (running) {
    return NextResponse.json(
      {
        error:
          "Project masih memiliki deployment aktif. Tunggu deployment selesai sebelum menghapus permanen.",
      },
      {
        status: 409,
      },
    );
  }

  const executor =
    await db
      .prepare(
        `SELECT
           url,
           token_encrypted
         FROM executor_settings
         WHERE id = 1`,
      )
      .first<{
        url: string;
        token_encrypted: string;
      }>();

  if (!executor) {
    return NextResponse.json(
      {
        error:
          "Executor belum dikonfigurasi. Permanent cleanup tidak dapat diverifikasi.",
      },
      {
        status: 503,
      },
    );
  }

  /*
   * STEP 1
   * Bersihkan resource server terlebih dahulu.
   * Project belum dihapus dari D1 jika tahap ini gagal.
   */
  let executorCleanup:
    unknown;

  try {
    const token =
      await decryptEnvironmentValue(
        executor.token_encrypted,
      );

    const response =
      await fetch(
        `${executor.url.replace(/\/+$/, "")}/projects/${project.id}/cleanup`,
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
              projectName:
                project.name,
              databaseType:
                project.database,
            }),
        },
      );

    const output =
      await response
        .json()
        .catch(
          () => ({}),
        ) as {
          error?: string;
          cleanup?: unknown;
        };

    if (!response.ok) {
      throw new Error(
        output.error ||
        `Executor cleanup gagal dengan HTTP ${response.status}.`,
      );
    }

    executorCleanup =
      output.cleanup ??
      null;
  } catch (error) {
    return NextResponse.json(
      {
        error:
          `Cleanup server gagal: ${
            error instanceof Error
              ? error.message
              : "Executor tidak merespons."
          }`,
      },
      {
        status: 502,
      },
    );
  }

  /*
   * STEP 2
   * Bersihkan Proxy Host NPM.
   *
   * Kalau NPM error, hentikan delete.
   * Jangan hapus metadata panel karena domain
   * belum dapat dipastikan bersih.
   */
  const settings =
    await db
      .prepare(
        `SELECT npm_url AS npmUrl
         FROM settings
         WHERE id = 1`,
      )
      .first<{
        npmUrl: string;
      }>();

  let npmCleanup:
    unknown =
      null;

  try {
    npmCleanup =
      await deleteNpmProxyHost({
        domain:
          project.domain,
        npmUrl:
          settings?.npmUrl ??
          "",
      });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          `Resource server sudah dibersihkan, tetapi Proxy Host NPM gagal dihapus: ${
            error instanceof Error
              ? error.message
              : "NPM tidak merespons."
          }. Project belum dihapus dari panel agar cleanup dapat dicoba ulang.`,
        executorCleanup,
      },
      {
        status: 502,
      },
    );
  }

  /*
   * STEP 3
   * Bersihkan semua artifact R2 dengan prefix project.
   * Ini mencakup ZIP lama yang mungkin tidak lagi
   * direferensikan oleh projects.archive_key.
   */
  let deletedArtifacts =
    0;

  try {
    deletedArtifacts =
      await deleteProjectArtifacts(
        project.id,
      );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          `Server dan domain sudah dibersihkan, tetapi artifact ZIP gagal dihapus: ${
            error instanceof Error
              ? error.message
              : "R2 tidak merespons."
          }. Project belum dihapus dari panel.`,
        executorCleanup,
        npmCleanup,
      },
      {
        status: 502,
      },
    );
  }

  /*
   * STEP 4
   * Metadata D1 dihapus PALING TERAKHIR.
   */
  try {
    await db.batch([
      db
        .prepare(
          `DELETE FROM backup_logs
           WHERE job_id IN (
             SELECT backup_jobs.id
             FROM backup_jobs
             INNER JOIN backups
               ON backups.id = backup_jobs.backup_id
             WHERE backups.project_id = ?
           )`,
        )
        .bind(
          project.id,
        ),

      db
        .prepare(
          `DELETE FROM backup_jobs
           WHERE backup_id IN (
             SELECT id
             FROM backups
             WHERE project_id = ?
           )`,
        )
        .bind(
          project.id,
        ),

      db
        .prepare(
          `DELETE FROM backups
           WHERE project_id = ?`,
        )
        .bind(
          project.id,
        ),

      db
        .prepare(
          `DELETE FROM deployment_logs
           WHERE deployment_id IN (
             SELECT id
             FROM deployments
             WHERE project_id = ?
           )`,
        )
        .bind(
          project.id,
        ),

      db
        .prepare(
          `DELETE FROM deployments
           WHERE project_id = ?`,
        )
        .bind(
          project.id,
        ),

      db
        .prepare(
          `DELETE FROM project_environment
           WHERE project_id = ?`,
        )
        .bind(
          project.id,
        ),

      db
        .prepare(
          `DELETE FROM project_resources
           WHERE project_id = ?`,
        )
        .bind(
          project.id,
        ),

      db
        .prepare(
          `DELETE FROM activity
           WHERE project_id = ?`,
        )
        .bind(
          project.id,
        ),

      db
        .prepare(
          `DELETE FROM nexa_service_requests
           WHERE project_id = ?`,
        )
        .bind(
          project.id,
        ),

      db
        .prepare(
          `DELETE FROM projects
           WHERE id = ?`,
        )
        .bind(
          project.id,
        ),
    ]);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          `Resource server, domain, dan artifact sudah dibersihkan, tetapi metadata panel gagal dihapus: ${
            error instanceof Error
              ? error.message
              : "D1 gagal memproses delete."
          }`,
        executorCleanup,
        npmCleanup,
        deletedArtifacts,
      },
      {
        status: 500,
      },
    );
  }

  return NextResponse.json({
    ok: true,

    project: {
      id:
        project.id,
      name:
        project.name,
      domain:
        project.domain,
    },

    cleanup: {
      executor:
        executorCleanup,

      npm:
        npmCleanup,

      artifacts:
        deletedArtifacts,

      metadata:
        true,
    },
  });
}
