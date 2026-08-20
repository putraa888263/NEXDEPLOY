import { NextResponse } from "next/server";
import { getD1 } from "@/db/bootstrap";

import {
  decryptEnvironmentValue,
  encryptEnvironmentValue,
  isProtectedEnvironmentKey,
  isSecretKey,
} from "../../../_lib/environment";

import {
  requireUser,
} from "../../../_lib/auth";

type EnvironmentEntry = {
  key: string;
  value: string;
  isSecret?: boolean;
};

function defaultEnvironment(
  project: {
    name: string;
    domain: string;
  },
) {
  return [
    {
      key: "APP_NAME",
      value: project.name,
      isSecret: false,
    },
    {
      key: "APP_URL",
      value: project.domain
        ? `https://${project.domain}`
        : "",
      isSecret: false,
    },
    {
      key: "MAIL_MAILER",
      value: "log",
      isSecret: false,
    },
  ] satisfies EnvironmentEntry[];
}

export async function GET(
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
  await requireUser(request);

  const {
    id,
  } =
    await params;

  const db =
    getD1();

  const project =
    await db
      .prepare(
        "SELECT name, domain FROM projects WHERE id = ?",
      )
      .bind(id)
      .first<{
        name: string;
        domain: string;
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

  const saved =
    await db
      .prepare(
        "SELECT key, value_encrypted AS valueEncrypted, is_secret AS isSecret, updated_at AS updatedAt FROM project_environment WHERE project_id = ? ORDER BY key",
      )
      .bind(id)
      .all<{
        key: string;
        valueEncrypted: string;
        isSecret: number;
        updatedAt: string;
      }>();

  if (
    !saved.results?.length
  ) {
    return NextResponse.json({
      environment:
        defaultEnvironment(
          project,
        ).map(
          (entry) => ({
            ...entry,
            saved: false,
            protected: false,
          }),
        ),
    });
  }

  const environment =
    await Promise.all(
      saved.results
        .filter(
          (entry) =>
            !isProtectedEnvironmentKey(
              entry.key,
            ),
        )
        .map(
          async (entry) => ({
            key:
              entry.key,

            value:
              entry.isSecret
                ? ""
                : await decryptEnvironmentValue(
                    entry.valueEncrypted,
                  ),

            isSecret:
              Boolean(
                entry.isSecret,
              ),

            saved:
              true,

            protected:
              false,

            updatedAt:
              entry.updatedAt,
          }),
        ),
    );

  return NextResponse.json({
    environment,
  });
}

export async function PUT(
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
    await requireUser(request);

  if (
    user.role === "Viewer"
  ) {
    return NextResponse.json(
      {
        error:
          "Role Viewer tidak dapat mengubah environment.",
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

  const body =
    await request
      .json()
      .catch(() => null) as
        | {
            environment?:
              EnvironmentEntry[];
          }
        | null;

  const entries =
    body?.environment ?? [];

  if (
    !Array.isArray(
      entries,
    ) ||
    entries.length > 100 ||
    entries.some(
      (entry) =>
        !entry ||
        typeof entry.key !==
          "string" ||
        !/^[A-Z_][A-Z0-9_]*$/.test(
          entry.key,
        ) ||
        typeof entry.value !==
          "string",
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Format environment tidak valid.",
      },
      {
        status: 400,
      },
    );
  }

  const duplicateKeys =
    entries
      .map(
        (entry) =>
          entry.key,
      )
      .filter(
        (
          key,
          index,
          all,
        ) =>
          all.indexOf(
            key,
          ) !== index,
      );

  if (
    duplicateKeys.length
  ) {
    return NextResponse.json(
      {
        error:
          "Environment variable tidak boleh duplikat.",
      },
      {
        status: 400,
      },
    );
  }

  const protectedKey =
    entries.find(
      (entry) =>
        isProtectedEnvironmentKey(
          entry.key,
        ),
    );

  if (
    protectedKey
  ) {
    return NextResponse.json(
      {
        error:
          `${protectedKey.key} dikelola otomatis oleh NEXDEPLOY.`,
      },
      {
        status: 400,
      },
    );
  }

  const db =
    getD1();

  const exists =
    await db
      .prepare(
        "SELECT id FROM projects WHERE id = ?",
      )
      .bind(id)
      .first();

  if (!exists) {
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

  const existing =
    await db
      .prepare(
        "SELECT key, value_encrypted AS valueEncrypted, is_secret AS isSecret FROM project_environment WHERE project_id = ?",
      )
      .bind(id)
      .all<{
        key: string;
        valueEncrypted: string;
        isSecret: number;
      }>();

  const existingByKey =
    new Map(
      (
        existing.results ??
        []
      ).map(
        (entry) => [
          entry.key,
          entry,
        ],
      ),
    );

  const now =
    new Date().toISOString();

  const statements = [
    db
      .prepare(
        "DELETE FROM project_environment WHERE project_id = ?",
      )
      .bind(id),
  ];

  for (
    const entry of entries
  ) {
    const secret =
      Boolean(
        entry.isSecret ??
          isSecretKey(
            entry.key,
          ),
      );

    const prior =
      existingByKey.get(
        entry.key,
      );

    const encrypted =
      secret &&
      !entry.value &&
      prior?.isSecret
        ? prior.valueEncrypted
        : await encryptEnvironmentValue(
            entry.value,
          );

    statements.push(
      db
        .prepare(
          "INSERT INTO project_environment (id, project_id, key, value_encrypted, is_secret, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(
          crypto.randomUUID(),
          id,
          entry.key,
          encrypted,
          secret ? 1 : 0,
          now,
        ),
    );
  }

  statements.push(
    db
      .prepare(
        "INSERT INTO activity (id, project_id, type, title, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(
        crypto.randomUUID(),
        id,
        "environment",
        "Environment diperbarui",
        `${user.name} memperbarui ${entries.length} variable environment.`,
        now,
      ),
  );

  await db.batch(
    statements,
  );

  return NextResponse.json({
    ok: true,
  });
}
