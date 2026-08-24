import { NextResponse } from "next/server";
import { getD1 } from "@/db/bootstrap";
import { requireUser } from "../../_lib/auth";
import { decryptEnvironmentValue } from "../../_lib/environment";

type ExecutorRow = {
  url: string;
  token_encrypted: string;
};

export async function GET(request: Request) {
  await requireUser(request);

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

    const response = await fetch(
      `${executor.url.replace(/\/+$/, "")}/system/metrics`,
      {
        headers: {
          authorization: `Bearer ${token}`,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      },
    );

    const result = (await response
      .json()
      .catch(() => ({}))) as {
      ok?: boolean;
      metrics?: unknown;
      error?: string;
    };

    if (
      !response.ok ||
      !result.ok ||
      !result.metrics
    ) {
      return NextResponse.json(
        {
          error:
            result.error ||
            "Executor gagal membaca metrics VPS.",
        },
        {
          status: 502,
        },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        metrics: result.metrics,
      },
      {
        headers: {
          "cache-control":
            "no-store, max-age=0",
        },
      },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "Executor tidak dapat dijangkau untuk membaca metrics VPS.",
      },
      {
        status: 502,
      },
    );
  }
}
