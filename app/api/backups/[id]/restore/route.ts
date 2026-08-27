import { NextResponse } from "next/server";
import { getD1 } from "@/db/bootstrap";
import { requireUser } from "../../../_lib/auth";
import { decryptEnvironmentValue } from "../../../_lib/environment";

type BackupRow = {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  status: string;
  fileName: string | null;
  databaseType: string | null;
};

type ExecutorRow = {
  url: string;
  token_encrypted: string;
};

type RestoreResult = {
  restore?: {
    databaseType?: string;
    restoredFrom?: string;
    safetyBackup?: string;
    safetyBackupSize?: number;
    database?: string;
    username?: string;
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
          "Role Viewer tidak dapat memulihkan backup.",
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

  const backup =
    await db
      .prepare(
        `
          SELECT
            backups.id,
            backups.project_id AS projectId,
            projects.name AS projectName,
            backups.name,
            backups.status,
            backups.file_name AS fileName,
            COALESCE(
              backups.database_type,
              projects.database_type
            ) AS databaseType
          FROM backups
          JOIN projects
            ON projects.id = backups.project_id
          WHERE backups.id = ?
        `,
      )
      .bind(id)
      .first<BackupRow>();

  if (!backup) {
    return NextResponse.json(
      {
        error:
          "Backup tidak ditemukan.",
      },
      {
        status: 404,
      },
    );
  }

  if (backup.status !== "Completed") {
    return NextResponse.json(
      {
        error:
          "Hanya backup yang selesai yang dapat dipulihkan.",
      },
      {
        status: 409,
      },
    );
  }

  if (!backup.fileName) {
    return NextResponse.json(
      {
        error:
          "Backup ini belum memiliki file database yang dapat dipulihkan.",
      },
      {
        status: 409,
      },
    );
  }

  if (
    ![
      "MariaDB",
      "PostgreSQL",
    ].includes(
      backup.databaseType ?? "",
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Jenis database backup tidak didukung untuk restore.",
      },
      {
        status: 400,
      },
    );
  }

  const runningRestore =
    await db
      .prepare(
        `
          SELECT backup_jobs.id
          FROM backup_jobs
          JOIN backups
            ON backups.id = backup_jobs.backup_id
          WHERE backups.project_id = ?
            AND backup_jobs.action = 'Restore'
            AND backup_jobs.status = 'Running'
          LIMIT 1
        `,
      )
      .bind(
        backup.projectId,
      )
      .first<{
        id: string;
      }>();

  if (runningRestore) {
    return NextResponse.json(
      {
        error:
          "Restore database project ini sedang berjalan.",
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
        status: 400,
      },
    );
  }

  const now =
    new Date().toISOString();

  const jobId =
    crypto.randomUUID();

  await db.batch([
    db
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
        "Restore",
        "Running",
        user.id,
        now,
      ),

    db
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
        "info",
        `Restore ${backup.databaseType} dimulai dari ${backup.fileName}.`,
        now,
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
        backup.projectId,
        "backup",
        "Restore database dimulai",
        `${user.name} memulihkan ${backup.name}.`,
        now,
      ),
  ]);

  try {
    const token =
      await decryptEnvironmentValue(
        executor.token_encrypted,
      );

    const response =
      await fetch(
        `${executor.url}/projects/${backup.projectId}/database/restore`,
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
              backup.databaseType,
            backupFileName:
              backup.fileName,
          }),
        },
      );

    const result =
      await response
        .json()
        .catch(() => ({})) as RestoreResult;

    if (
      !response.ok ||
      !result.restore?.restoredFrom ||
      !result.restore?.safetyBackup
    ) {
      throw new Error(
        result.error ||
        "Executor gagal memulihkan database.",
      );
    }

    const completedAt =
      new Date().toISOString();

    await db.batch([
      db
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

      db
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
          `Restore selesai dari ${result.restore.restoredFrom}. Safety backup: ${result.restore.safetyBackup}.`,
          completedAt,
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
          backup.projectId,
          "backup",
          "Restore database selesai",
          `${backup.projectName} berhasil dipulihkan dari ${backup.name}. Safety backup ${result.restore.safetyBackup} dibuat otomatis.`,
          completedAt,
        ),
    ]);

    return NextResponse.json({
      ok: true,
      job: {
        id:
          jobId,
        status:
          "Completed",
      },
      restore:
        result.restore,
    });
  } catch (error) {
    const finishedAt =
      new Date().toISOString();

    const message =
      error instanceof Error
        ? error.message
        : "Restore database gagal.";

    await db.batch([
      db
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

      db
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
          backup.projectId,
          "backup",
          "Restore database gagal",
          `${user.name} gagal memulihkan ${backup.name}: ${message}`,
          finishedAt,
        ),
    ]);

    return NextResponse.json(
      {
        error:
          message,
        job: {
          id:
            jobId,
          status:
            "Failed",
        },
      },
      {
        status: 502,
      },
    );
  }
}
