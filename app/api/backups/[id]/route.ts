import { NextResponse } from "next/server";
import { getD1 } from "@/db/bootstrap";
import { requireUser } from "../../_lib/auth";
import { decryptEnvironmentValue } from "../../_lib/environment";

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

export async function DELETE(
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
          "Role Viewer tidak dapat menghapus backup.",
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

  if (
    backup.status === "Running"
  ) {
    return NextResponse.json(
      {
        error:
          "Backup yang sedang berjalan tidak dapat dihapus.",
      },
      {
        status: 409,
      },
    );
  }

  if (
    backup.status === "Completed"
  ) {
    if (
      !backup.fileName ||
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
            "Backup selesai versi lama belum memiliki referensi file yang aman untuk dihapus.",
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

    try {
      const token =
        await decryptEnvironmentValue(
          executor.token_encrypted,
        );

      const response =
        await fetch(
          `${executor.url}/projects/${backup.projectId}/database/backup/delete`,
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
              fileName:
                backup.fileName,
            }),
          },
        );

      const result =
        await response
          .json()
          .catch(() => ({})) as {
            error?: string;
          };

      if (!response.ok) {
        return NextResponse.json(
          {
            error:
              result.error ||
              "File backup gagal dihapus dari executor.",
          },
          {
            status: 502,
          },
        );
      }
    } catch {
      return NextResponse.json(
        {
          error:
            "Executor tidak dapat dijangkau saat menghapus backup.",
        },
        {
          status: 502,
        },
      );
    }
  }

  const now =
    new Date().toISOString();

  await db.batch([
    db
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
      .bind(backup.id),

    db
      .prepare(
        `
          DELETE FROM backup_jobs
          WHERE backup_id = ?
        `,
      )
      .bind(backup.id),

    db
      .prepare(
        `
          DELETE FROM backups
          WHERE id = ?
        `,
      )
      .bind(backup.id),

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
        "Backup dihapus",
        `${user.name} menghapus backup ${backup.name}.`,
        now,
      ),
  ]);

  return NextResponse.json({
    ok: true,
    deletedBackupId:
      backup.id,
  });
}
