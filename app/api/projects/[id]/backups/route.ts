import { NextResponse } from "next/server";
import { getD1 } from "@/db/bootstrap";
import { requireUser } from "../../../_lib/auth";
import { decryptEnvironmentValue } from "../../../_lib/environment";

async function addLog(jobId: string, level: string, message: string) {
  await getD1().prepare("INSERT INTO backup_logs (id, job_id, level, message, created_at) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), jobId, level, message, new Date().toISOString()).run();
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser(request);
  const { id } = await params;
  const results = await getD1().prepare("SELECT backups.id, backups.name, backups.type, backups.status, backups.size, backups.file_name AS fileName, backups.database_type AS databaseType, backups.retention_days AS retentionDays, backups.created_at AS createdAt, backups.completed_at AS completedAt FROM backups WHERE project_id = ? ORDER BY created_at DESC").bind(id).all();
  return NextResponse.json({ backups: results.results ?? [] });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser(request);

  if (user.role === "Viewer") {
    return NextResponse.json(
      {
        error:
          "Role Viewer tidak dapat membuat backup.",
      },
      {
        status: 403,
      },
    );
  }

  const { id } = await params;

  const project = await getD1()
    .prepare(
      `
        SELECT
          id,
          slug,
          database_type AS database,
          EXISTS (
            SELECT 1
            FROM deployments
            WHERE deployments.project_id = projects.id
              AND deployments.status = 'Succeeded'
              AND deployments.action = 'Deploy'
          ) AS hasSuccessfulDeployment
        FROM projects
        WHERE id = ?
      `,
    )
    .bind(id)
    .first<{
      id: string;
      slug: string;
      database: string;
      hasSuccessfulDeployment: number;
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

  if (!project.hasSuccessfulDeployment) {
    return NextResponse.json(
      {
        error:
          "Project harus berhasil dideploy sebelum database dapat dibackup.",
      },
      {
        status: 409,
      },
    );
  }

  if (
    ![
      "PostgreSQL",
      "MariaDB",
    ].includes(project.database)
  ) {
    return NextResponse.json(
      {
        error:
          "Project ini tidak menggunakan database.",
      },
      {
        status: 400,
      },
    );
  }

  const executor = await getD1()
    .prepare(
      `
        SELECT
          url,
          token_encrypted
        FROM executor_settings
        WHERE id = 1
      `,
    )
    .first<{
      url: string;
      token_encrypted: string;
    }>();

  if (!executor) {
    return NextResponse.json(
      {
        error:
          "Executor belum dikonfigurasi.",
      },
      {
        status: 400,
      },
    );
  }

  const retention = await getD1()
    .prepare(
      `
        SELECT backup_retention
        FROM settings
        WHERE id = 1
      `,
    )
    .first<{
      backup_retention: number;
    }>();

  const now = new Date();

  const backup = {
    id: crypto.randomUUID(),
    name:
      `${project.slug}-${now
        .toISOString()
        .replace(/[:.]/g, "-")}`,
    type: "Manual",
    status: "Running",
    retentionDays:
      retention?.backup_retention ?? 7,
    createdAt:
      now.toISOString(),
  };

  const jobId =
    crypto.randomUUID();

  await getD1().batch([
    getD1()
      .prepare(
        `
          INSERT INTO backups (
            id,
            project_id,
            name,
            type,
            status,
            database_type,
            retention_days,
            created_by,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        backup.id,
        id,
        backup.name,
        backup.type,
        backup.status,
        project.database,
        backup.retentionDays,
        user.id,
        backup.createdAt,
      ),

    getD1()
      .prepare(
        `
          INSERT INTO backup_jobs (
            id,
            backup_id,
            action,
            status,
            requested_by,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        jobId,
        backup.id,
        "Create",
        "Running",
        user.id,
        backup.createdAt,
      ),

    getD1()
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
        "backup",
        "Backup database dimulai",
        `${user.name} meminta backup ${backup.name}.`,
        backup.createdAt,
      ),
  ]);

  await addLog(
    jobId,
    "info",
    "Permintaan backup database dikirim ke executor.",
  );

  try {
    const token =
      await decryptEnvironmentValue(
        executor.token_encrypted,
      );

    const response = await fetch(
      `${executor.url}/projects/${id}/database/backup`,
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json",
          authorization:
            `Bearer ${token}`,
        },
        body: JSON.stringify({
          databaseType:
            project.database,
          retention:
            backup.retentionDays,
        }),
      },
    );

    const result = await response
      .json()
      .catch(() => ({})) as {
        backup?: {
          fileName?: string;
          path?: string;
          size?: number;
          prunedFiles?: string[];
        };
        error?: string;
      };

    if (
      !response.ok ||
      !result.backup?.fileName
    ) {
      throw new Error(
        result.error ||
        "Executor gagal membuat backup database.",
      );
    }

    const prunedFiles =
      Array.isArray(
        result.backup.prunedFiles,
      )
        ? result.backup.prunedFiles.filter(
            (fileName): fileName is string =>
              typeof fileName === "string" &&
              fileName.length > 0,
          )
        : [];

    const prunedBackupIds =
      new Set<string>();

    for (const prunedFile of prunedFiles) {
      const prunedBackups =
        await getD1()
          .prepare(
            `
              SELECT id
              FROM backups
              WHERE project_id = ?
                AND file_name = ?
                AND id <> ?
            `,
          )
          .bind(
            id,
            prunedFile,
            backup.id,
          )
          .all<{ id: string }>();

      for (const prunedBackup of prunedBackups.results ?? []) {
        prunedBackupIds.add(
          prunedBackup.id,
        );

        await getD1()
          .prepare(
            `
              DELETE FROM backup_logs
              WHERE job_id IN (
                SELECT id
                FROM backup_jobs
                WHERE backup_id = ?
              )
            `,
          )
          .bind(
            prunedBackup.id,
          )
          .run();

        await getD1()
          .prepare(
            `
              DELETE FROM backup_jobs
              WHERE backup_id = ?
            `,
          )
          .bind(
            prunedBackup.id,
          )
          .run();
      }

      await getD1()
        .prepare(
          `
            DELETE FROM backups
            WHERE project_id = ?
              AND file_name = ?
              AND id <> ?
          `,
        )
        .bind(
          id,
          prunedFile,
          backup.id,
        )
        .run();
    }

    const completedAt =
      new Date().toISOString();

    const size =
      typeof result.backup.size ===
        "number"
        ? result.backup.size
        : null;

    await getD1().batch([
      getD1()
        .prepare(
          `
            UPDATE backups
            SET
              status = 'Completed',
              size = ?,
              file_name = ?,
              completed_at = ?
            WHERE id = ?
          `,
        )
        .bind(
          size,
          result.backup.fileName,
          completedAt,
          backup.id,
        ),

      getD1()
        .prepare(
          `
            UPDATE backup_jobs
            SET
              status = 'Completed',
              error = NULL,
              finished_at = ?
            WHERE id = ?
          `,
        )
        .bind(
          completedAt,
          jobId,
        ),

      getD1()
        .prepare(
          `
            INSERT INTO backup_logs (
              id,
              job_id,
              level,
              message,
              created_at
            )
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .bind(
          crypto.randomUUID(),
          jobId,
          "success",
          `Backup selesai: ${result.backup.fileName}`,
          completedAt,
        ),

      getD1()
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
          "backup",
          "Backup database selesai",
          `Backup ${result.backup.fileName} berhasil dibuat.`,
          completedAt,
        ),
    ]);

    return NextResponse.json(
      {
        backup: {
          ...backup,
          status:
            "Completed",
          size,
          completedAt,
          fileName:
            result.backup.fileName,
          databaseType:
            project.database,
        },
        prunedBackupIds:
          [...prunedBackupIds],
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    const finishedAt =
      new Date().toISOString();

    const message =
      error instanceof Error
        ? error.message
        : "Backup database gagal.";

    await getD1().batch([
      getD1()
        .prepare(
          `
            UPDATE backups
            SET
              status = 'Failed',
              completed_at = ?
            WHERE id = ?
          `,
        )
        .bind(
          finishedAt,
          backup.id,
        ),

      getD1()
        .prepare(
          `
            UPDATE backup_jobs
            SET
              status = 'Failed',
              error = ?,
              finished_at = ?
            WHERE id = ?
          `,
        )
        .bind(
          message,
          finishedAt,
          jobId,
        ),

      getD1()
        .prepare(
          `
            INSERT INTO backup_logs (
              id,
              job_id,
              level,
              message,
              created_at
            )
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .bind(
          crypto.randomUUID(),
          jobId,
          "error",
          message,
          finishedAt,
        ),
    ]);

    return NextResponse.json(
      {
        error: message,
      },
      {
        status: 502,
      },
    );
  }
}
