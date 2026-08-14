import { NextResponse } from "next/server";
import { ensureDatabase, getD1 } from "@/db/bootstrap";
import { processDeployment, syncExecutorDeployment } from "../../_lib/deployment";

const enc = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((v) => v.toString(16).padStart(2, "0")).join("");

async function verify(request: Request, raw: string) {
  const secret = process.env.NEXA_SERVICE_SECRET ?? "";
  const ts = request.headers.get("x-nexa-timestamp") ?? "";
  const nonce = request.headers.get("x-nexa-nonce") ?? "";
  const supplied = (request.headers.get("x-nexa-signature") ?? "").toLowerCase();
  if (
    secret.length < 32 || !/^\d{10}$/.test(ts) || !/^[a-f0-9]{32}$/.test(nonce) ||
    !/^[a-f0-9]{64}$/.test(supplied) || Math.abs(Date.now() / 1000 - Number(ts)) > 300
  ) throw new Response(JSON.stringify({ error: "service_auth_invalid" }), { status: 401 });
  const url = new URL(request.url);
  const bodyHash = hex(await crypto.subtle.digest("SHA-256", enc.encode(raw)));
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${request.method}\n${url.pathname}\n${ts}\n${nonce}\n${bodyHash}`)));
  if (expected !== supplied) throw new Response(JSON.stringify({ error: "service_auth_invalid" }), { status: 401 });
  await ensureDatabase();
  try {
    await getD1().prepare("INSERT INTO nexa_service_nonces(nonce,seen_at) VALUES(?,?)").bind(nonce, new Date().toISOString()).run();
  } catch {
    throw new Response(JSON.stringify({ error: "replay_rejected" }), { status: 409 });
  }
}

function slugify(v: string) {
  return v.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function refreshDeployments(projectId: string) {
  const pending = await getD1().prepare(
    "SELECT id FROM deployments WHERE project_id=? AND executor_job_id IS NOT NULL AND status IN ('Queued','Running','WaitingExecutor') ORDER BY created_at DESC LIMIT 10",
  ).bind(projectId).all<{ id: string }>();
  await Promise.all((pending.results ?? []).map((item) => syncExecutorDeployment(item.id)));
}

export async function POST(request: Request) {
  const raw = await request.text();
  await verify(request, raw);
  const body = JSON.parse(raw || "{}") as Record<string, unknown>;
  const operation = String(body.operation ?? "capabilities");

  if (operation === "capabilities") {
    return NextResponse.json({
      authority: "NEXDEPLOY",
      service_api: true,
      operations: ["project.register", "project.status", "release.status", "deploy.request", "rollback.request"],
      deployment_requires_approved_action: true,
      rollback_redeploys_verified_release_artifact: true,
      status_refreshes_executor: true,
      arbitrary_command: false,
    });
  }

  const idempotencyKey = String(body.idempotency_key ?? "");
  if (idempotencyKey.length < 12 || idempotencyKey.length > 160) {
    return NextResponse.json({ error: "idempotency_key_required" }, { status: 422 });
  }
  const prior = await getD1().prepare("SELECT result_json FROM nexa_service_requests WHERE idempotency_key=?")
    .bind(idempotencyKey).first<{ result_json: string }>();
  if (prior) return NextResponse.json(JSON.parse(prior.result_json));

  let result: Record<string, unknown>;
  let projectId = String(body.project_id ?? "").trim();

  if (operation === "project.register") {
    const name = String(body.name ?? "").trim();
    const framework = String(body.framework ?? "");
    const database = String(body.database ?? "Tanpa database");
    if (!name || !["Laravel", "PHP Native"].includes(framework) || !["MariaDB", "PostgreSQL", "Tanpa database"].includes(database)) {
      return NextResponse.json({ error: "project_contract_invalid" }, { status: 422 });
    }
    const slug = slugify(name);
    const existing = await getD1().prepare("SELECT id,name,slug,status FROM projects WHERE slug=?").bind(slug).first();
    if (existing) {
      result = { project: existing, idempotent: true };
      projectId = String((existing as { id: string }).id);
    } else {
      const settings = await getD1().prepare("SELECT base_domain FROM settings WHERE id=1").first<{ base_domain: string }>();
      projectId = crypto.randomUUID();
      const now = new Date().toISOString();
      await getD1().prepare("INSERT INTO projects(id,name,slug,domain,framework,database_type,version,status,cpu,memory,color,created_at,updated_at) VALUES(?,?,?,?,?,?,'v1.0.0','Stopped',0,0,'#2563eb',?,?)")
        .bind(projectId, name, slug, `${slug}.${settings?.base_domain ?? "localhost"}`, framework, database, now, now).run();
      result = { project: { id: projectId, name, slug, status: "Stopped" } };
    }
  } else if (["project.status", "release.status"].includes(operation)) {
    await refreshDeployments(projectId);
    const project = await getD1().prepare("SELECT id,name,slug,domain,status,version,updated_at AS updatedAt FROM projects WHERE id=?")
      .bind(projectId).first();
    if (!project) return NextResponse.json({ error: "project_not_found" }, { status: 404 });
    const deployments = await getD1().prepare(
      "SELECT id,status,action,source_deployment_id AS sourceDeploymentId,error,created_at AS createdAt,started_at AS startedAt,finished_at AS finishedAt FROM deployments WHERE project_id=? ORDER BY created_at DESC LIMIT 10",
    ).bind(projectId).all();
    result = { project, deployments: deployments.results ?? [] };
  } else if (["deploy.request", "rollback.request"].includes(operation)) {
    const proposalId = String(body.proposal_id ?? "");
    if (body.approved !== true || !/^NEXA-[A-F0-9]{12}$/.test(proposalId)) {
      return NextResponse.json({ error: "approved_typed_proposal_required" }, { status: 403 });
    }
    const project = await getD1().prepare("SELECT id,name,framework,archive_key,archive_name FROM projects WHERE id=?")
      .bind(projectId).first<{ id: string; name: string; framework: string; archive_key: string | null; archive_name: string | null }>();
    if (!project) return NextResponse.json({ error: "project_not_found" }, { status: 404 });

    let archiveKey = project.archive_key;
    let archiveName = project.archive_name;
    let sourceDeploymentId: string | null = null;
    const action = operation === "rollback.request" ? "Rollback" : "Deploy";

    if (operation === "rollback.request") {
      const source = await getD1().prepare(
        "SELECT id,archive_key AS archiveKey,archive_name AS archiveName FROM deployments WHERE project_id=? AND status='Succeeded' AND action='Deploy' ORDER BY finished_at DESC, created_at DESC LIMIT 1",
      ).bind(projectId).first<{ id: string; archiveKey: string; archiveName: string }>();
      if (!source) return NextResponse.json({ error: "rollback_release_unavailable" }, { status: 422 });
      sourceDeploymentId = source.id;
      archiveKey = source.archiveKey;
      archiveName = source.archiveName;
    }

    if (!archiveKey || !archiveName) return NextResponse.json({ error: "approved_artifact_unavailable" }, { status: 422 });
    const running = await getD1().prepare("SELECT id FROM deployments WHERE project_id=? AND status IN ('Queued','Running') LIMIT 1").bind(projectId).first();
    if (running) return NextResponse.json({ error: "deployment_already_running" }, { status: 409 });

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await getD1().prepare(
      "INSERT INTO deployments(id,project_id,status,requested_by,archive_key,archive_name,executor,action,source_deployment_id,created_at) VALUES(?,?,'Queued',?,?,?,'local-worker',?,?,?)",
    ).bind(id, projectId, String(body.requester_ref ?? "service:nexa"), archiveKey, archiveName, action, sourceDeploymentId, now).run();

    await processDeployment(id, { id: projectId, name: project.name, archive_key: archiveKey, archive_name: archiveName, framework: project.framework });
    await syncExecutorDeployment(id);
    const deployment = await getD1().prepare(
      "SELECT id,status,action,source_deployment_id AS sourceDeploymentId,error,created_at AS createdAt,started_at AS startedAt,finished_at AS finishedAt FROM deployments WHERE id=?",
    ).bind(id).first();
    result = { deployment, execution: "typed_executor_dispatched" };
  } else {
    return NextResponse.json({ error: "operation_denied" }, { status: 403 });
  }

  await getD1().prepare("INSERT INTO nexa_service_requests(idempotency_key,operation,project_id,result_json,created_at) VALUES(?,?,?,?,?)")
    .bind(idempotencyKey, operation, projectId || null, JSON.stringify(result), new Date().toISOString()).run();
  return NextResponse.json(result);
}
