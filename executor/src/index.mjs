import { createServer } from "node:http";
import { mkdir, access, readFile, writeFile, rename, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, resolve, basename } from "node:path";
import { randomUUID } from "node:crypto";

async function loadLocalEnvironment() { try { const source = await readFile(new URL("../.env", import.meta.url), "utf8"); for (const line of source.split(/\r?\n/)) { const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } } catch (error) { if (error?.code !== "ENOENT") throw error; } }
await loadLocalEnvironment();
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";
const token = process.env.EXECUTOR_TOKEN;
const projectsDir = resolve(process.env.PROJECTS_DIR || "./executor-work");
const stateDir = join(projectsDir, ".nexdeploy", "jobs");
const jobs = new Map();
if (!token) throw new Error("EXECUTOR_TOKEN wajib diisi di executor/.env sebelum executor dijalankan.");

function json(response, status, body) { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body)); }
async function body(request) { let raw = ""; for await (const part of request) raw += part; return raw ? JSON.parse(raw) : {}; }
function authorized(request) { return request.headers.authorization === `Bearer ${token}`; }
function jobFile(id) { return join(stateDir, `${id}.json`); }
async function save(job) { await mkdir(stateDir, { recursive: true }); await writeFile(jobFile(job.id), JSON.stringify(job, null, 2)); }
async function load(id) { if (jobs.has(id)) return jobs.get(id); try { const job = JSON.parse(await readFile(jobFile(id), "utf8")); jobs.set(id, job); return job; } catch { return null; } }
async function log(job, level, message) { job.logs.push({ at: new Date().toISOString(), level, message }); await save(job); }
function command(command, args) { return new Promise((resolveCommand, reject) => { const child = spawn(command, args, { windowsHide: true }); let output = ""; child.stdout.on("data", (data) => output += data); child.stderr.on("data", (data) => output += data); child.on("error", reject); child.on("close", (code) => code === 0 ? resolveCommand(output) : reject(new Error(output.trim() || `${command} gagal.`))); }); }
async function listArchive(archivePath) { try { return await command("unzip", ["-Z1", archivePath]); } catch { return command("tar", ["-tf", archivePath]); } }
async function extractArchive(archivePath, destination) { try { await command("unzip", ["-q", archivePath, "-d", destination]); } catch { await command("tar", ["-xf", archivePath, "-C", destination]); } }
function safeArchiveList(list) { const entries = list.split(/\r?\n/).filter(Boolean); if (!entries.length || entries.length > 50000) throw new Error("ZIP kosong atau memuat terlalu banyak file."); if (entries.some((entry) => entry.startsWith("/") || entry.split(/[\\/]/).includes(".."))) throw new Error("ZIP memiliki path file yang tidak aman."); return entries; }
async function processArchive(job) {
  job.status = "running"; await log(job, "info", "Arsip diterima executor dan disimpan secara persisten.");
  const archivePath = join(projectsDir, ".nexdeploy", "archives", `${job.id}-${basename(job.payload.archiveName)}`);
  const entries = safeArchiveList(await listArchive(archivePath)); await log(job, "success", `Validasi aman selesai: ${entries.length} file ditemukan.`);
  const releaseRoot = join(projectsDir, job.payload.projectId, "releases"); const release = join(releaseRoot, job.id);
  await rm(release, { recursive: true, force: true }); await mkdir(release, { recursive: true }); await extractArchive(archivePath, release);
  job.releasePath = release; await log(job, "success", "ZIP berhasil diekstrak ke release baru.");
  await log(job, "warning", "Release siap. Composer, Docker, database, dan NPM akan dijalankan setelah konfigurasi VPS tersedia.");
  job.status = "waiting_vps"; job.finishedAt = new Date().toISOString(); await save(job);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/health") { const supplied = request.headers.authorization; if (supplied && !authorized(request)) return json(response, 401, { error: "Token executor tidak valid." }); let workspace = "ready"; try { await access(projectsDir); } catch { workspace = "will-create"; } return json(response, 200, { ok: true, version: "0.2.0", mode: "local", services: { executor: "ready", workspace, docker: "not-configured", database: "not-configured", npm: "not-configured" } }); }
    if (!authorized(request)) return json(response, 401, { error: "Token executor tidak valid." });
    if (request.method === "POST" && url.pathname === "/jobs/deploy") { const payload = await body(request); if (!payload.projectId || !payload.archiveName) return json(response, 400, { error: "projectId dan archiveName wajib diisi." }); const job = { id: randomUUID(), type: "deploy", status: "awaiting_archive", payload, createdAt: new Date().toISOString(), logs: [] }; jobs.set(job.id, job); await log(job, "info", "Job disimpan dan menunggu arsip ZIP dari panel."); return json(response, 202, { job: { id: job.id, status: job.status } }); }
    const archiveMatch = url.pathname.match(/^\/jobs\/([^/]+)\/archive$/);
    if (request.method === "PUT" && archiveMatch) { const job = await load(archiveMatch[1]); if (!job) return json(response, 404, { error: "Job tidak ditemukan." }); if (job.status !== "awaiting_archive") return json(response, 409, { error: "Arsip sudah diterima untuk job ini." }); const chunks = []; let bytes = 0; for await (const chunk of request) { bytes += chunk.length; if (bytes > 100 * 1024 * 1024) return json(response, 413, { error: "Arsip maksimal 100 MB." }); chunks.push(chunk); } const archiveDir = join(projectsDir, ".nexdeploy", "archives"); await mkdir(archiveDir, { recursive: true }); await writeFile(join(archiveDir, `${job.id}-${basename(job.payload.archiveName)}`), Buffer.concat(chunks)); void processArchive(job).catch(async (error) => { job.status = "failed"; job.finishedAt = new Date().toISOString(); await log(job, "error", error instanceof Error ? error.message : "Ekstraksi ZIP gagal."); }); return json(response, 202, { ok: true }); }
    const match = url.pathname.match(/^\/jobs\/([^/]+)(\/logs)?$/);
    if (request.method === "GET" && match) { const job = await load(match[1]); if (!job) return json(response, 404, { error: "Job tidak ditemukan." }); return json(response, 200, match[2] ? { logs: job.logs } : { job: { ...job, logs: undefined } }); }
    return json(response, 404, { error: "Endpoint tidak ditemukan." });
  } catch (error) { return json(response, 500, { error: error instanceof Error ? error.message : "Executor gagal memproses permintaan." }); }
});
server.listen(port, host, () => console.log(`NEXDEPLOY executor aktif di http://${host}:${port}`));
