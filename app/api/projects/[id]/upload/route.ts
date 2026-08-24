import { NextResponse } from "next/server";
import { getD1, getUploads } from "@/db/bootstrap";
import { requireUser } from "../../../_lib/auth";
import { inspectApplicationArchive } from "../../../_lib/zip";

const maxArchiveSize =
  100 * 1024 * 1024;

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
    await requireUser(
      request,
    );

  if (
    user.role ===
    "Viewer"
  ) {
    return NextResponse.json(
      {
        error:
          "Role Viewer tidak dapat mengunggah aplikasi.",
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

  if (
    !request.headers
      .get("content-type")
      ?.startsWith(
        "multipart/form-data",
      )
  ) {
    return NextResponse.json(
      {
        error:
          "Pilih file ZIP aplikasi.",
      },
      {
        status: 400,
      },
    );
  }

  const form =
    await request.formData();

  const archive =
    form.get(
      "archive",
    );

  // File tidak tersedia sebagai runtime global
  // pada seluruh adapter Workers lokal.
  if (
    typeof archive ===
      "string" ||
    !archive ||
    !archive.name
      .toLowerCase()
      .endsWith(".zip")
  ) {
    return NextResponse.json(
      {
        error:
          "Pilih file ZIP aplikasi.",
      },
      {
        status: 400,
      },
    );
  }

  if (
    !archive.size ||
    archive.size >
      maxArchiveSize
  ) {
    return NextResponse.json(
      {
        error:
          "Ukuran ZIP harus antara 1 byte dan 100 MB pada panel lokal.",
      },
      {
        status: 400,
      },
    );
  }

  const db =
    getD1();

  const uploads =
    getUploads();

  const project =
    await db
      .prepare(
        `SELECT
           id,
           name,
           slug,
           framework,
           archive_key AS archiveKey
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
        framework: string;
        archiveKey: string | null;
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

  const archiveBytes =
    await archive.arrayBuffer();

  let validation:
    Awaited<
      ReturnType<
        typeof inspectApplicationArchive
      >
    >;

  try {
    validation =
      await inspectApplicationArchive(
        archiveBytes,
        project.framework,
      );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "ZIP tidak dapat diperiksa.",
      },
      {
        status: 400,
      },
    );
  }

  const safeName =
    archive.name.replace(
      /[^a-zA-Z0-9._-]/g,
      "-",
    );

  const key =
    `projects/${project.id}/${Date.now()}-${safeName}`;

  /*
   * STEP 1
   * Simpan ZIP baru terlebih dahulu.
   */
  try {
    await uploads.put(
      key,
      new Uint8Array(
        archiveBytes,
      ),
      {
        httpMetadata: {
          contentType:
            "application/zip",
        },
        customMetadata: {
          projectId:
            project.id,
          uploadedBy:
            user.id,
        },
      },
    );
  } catch (error) {
    console.error(
      "Gagal menyimpan ZIP ke R2 lokal",
      error,
    );

    const reason =
      error instanceof Error &&
      error.message
        ? ` (${error.message})`
        : "";

    return NextResponse.json(
      {
        error:
          `ZIP lolos validasi, tetapi penyimpanan lokal tidak merespons${reason}. Jalankan ulang panel lalu coba lagi.`,
      },
      {
        status: 503,
      },
    );
  }

  const now =
    new Date().toISOString();

  /*
   * STEP 2
   * Update metadata project.
   *
   * Kalau D1 gagal setelah ZIP baru sudah masuk R2,
   * ZIP baru dibersihkan supaya tidak menjadi orphan.
   */
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE projects
           SET
             archive_key = ?,
             archive_name = ?,
             archive_size = ?,
             archive_validation = ?,
             updated_at = ?
           WHERE id = ?`,
        )
        .bind(
          key,
          archive.name,
          archive.size,
          JSON.stringify(
            validation,
          ),
          now,
          project.id,
        ),

      db
        .prepare(
          `INSERT INTO activity (
             id,
             project_id,
             type,
             title,
             detail,
             created_at
           )
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          project.id,
          "deployment",
          "ZIP aplikasi tervalidasi",
          `${archive.name} memuat ${validation.files} file dan siap diproses oleh worker deployment.`,
          now,
        ),
    ]);
  } catch (error) {
    try {
      await uploads.delete(
        key,
      );
    } catch (cleanupError) {
      console.error(
        "Gagal membersihkan ZIP baru setelah update D1 gagal",
        cleanupError,
      );
    }

    console.error(
      "Gagal memperbarui metadata ZIP project",
      error,
    );

    return NextResponse.json(
      {
        error:
          "ZIP berhasil diunggah, tetapi metadata project gagal diperbarui. Upload baru dibatalkan.",
      },
      {
        status: 500,
      },
    );
  }

  /*
   * STEP 3
   * Cleanup ZIP lama HANYA jika tidak lagi
   * direferensikan oleh deployment history.
   *
   * deployment.archive_key dipakai untuk rollback,
   * jadi artifact yang masih direferensikan wajib dipertahankan.
   */
  let previousArchiveDeleted =
    false;

  let previousArchiveRetained =
    false;

  if (
    project.archiveKey &&
    project.archiveKey !== key
  ) {
    try {
      const reference =
        await db
          .prepare(
            `SELECT id
             FROM deployments
             WHERE archive_key = ?
             LIMIT 1`,
          )
          .bind(
            project.archiveKey,
          )
          .first<{
            id: string;
          }>();

      if (reference) {
        previousArchiveRetained =
          true;
      } else {
        await uploads.delete(
          project.archiveKey,
        );

        previousArchiveDeleted =
          true;
      }
    } catch (error) {
      /*
       * Upload baru tetap dianggap sukses.
       * Cleanup artifact lama adalah best-effort.
       */
      console.error(
        "ZIP baru aktif, tetapi cleanup ZIP lama gagal",
        error,
      );
    }
  }

  return NextResponse.json(
    {
      archive: {
        name:
          archive.name,
        size:
          archive.size,
        ...validation,
      },

      cleanup: {
        previousArchiveDeleted,
        previousArchiveRetained,
      },
    },
    {
      status: 201,
    },
  );
}
