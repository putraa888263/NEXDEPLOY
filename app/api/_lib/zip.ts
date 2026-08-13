const centralDirectorySignature = 0x02014b50;
const endOfDirectorySignature = 0x06054b50;
const storedMethod = 0;
const deflatedMethod = 8;

function stripCommonRoot(entries: string[]) {
  const roots = entries.filter((entry) => entry.includes("/")).map((entry) => entry.split("/")[0]);
  return roots.length === entries.length && new Set(roots).size === 1
    ? entries.map((entry) => entry.slice(roots[0].length + 1))
    : entries;
}

type ZipEntry = { path: string; compression: number; compressedSize: number; uncompressedSize: number; localOffset: number };

function readZipEntries(bytes: ArrayBuffer) {
  const data = new DataView(bytes);
  if (data.byteLength < 22 || data.getUint32(0, true) !== 0x04034b50) throw new Error("File bukan arsip ZIP yang valid.");
  const start = Math.max(0, data.byteLength - 65557);
  let endOffset = -1;
  for (let index = data.byteLength - 22; index >= start; index -= 1) {
    if (data.getUint32(index, true) === endOfDirectorySignature) { endOffset = index; break; }
  }
  if (endOffset < 0) throw new Error("Direktori ZIP tidak ditemukan.");
  const entriesCount = data.getUint16(endOffset + 10, true);
  let offset = data.getUint32(endOffset + 16, true);
  if (entriesCount > 10000) throw new Error("ZIP memuat terlalu banyak file.");
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let index = 0; index < entriesCount; index += 1) {
    if (offset + 46 > data.byteLength || data.getUint32(offset, true) !== centralDirectorySignature) throw new Error("Struktur ZIP tidak valid.");
    const nameLength = data.getUint16(offset + 28, true);
    const extraLength = data.getUint16(offset + 30, true);
    const commentLength = data.getUint16(offset + 32, true);
    const name = decoder.decode(new Uint8Array(bytes, offset + 46, nameLength)).replaceAll("\\", "/");
    if (name.startsWith("/") || name.split("/").includes("..")) throw new Error("ZIP memiliki path file yang tidak aman.");
    const compression = data.getUint16(offset + 10, true);
    if (![storedMethod, deflatedMethod].includes(compression)) throw new Error("ZIP menggunakan metode kompresi yang tidak didukung.");
    entries.push({ path: name, compression, compressedSize: data.getUint32(offset + 20, true), uncompressedSize: data.getUint32(offset + 24, true), localOffset: data.getUint32(offset + 42, true) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function readEntry(bytes: ArrayBuffer, entry: ZipEntry) {
  const data = new DataView(bytes);
  if (entry.localOffset + 30 > data.byteLength || data.getUint32(entry.localOffset, true) !== 0x04034b50) throw new Error("Data file ZIP tidak valid.");
  const nameLength = data.getUint16(entry.localOffset + 26, true);
  const extraLength = data.getUint16(entry.localOffset + 28, true);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const compressed = new Uint8Array(bytes, start, entry.compressedSize);
  if (entry.compression === storedMethod) return new TextDecoder().decode(compressed);
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

export async function inspectApplicationArchive(bytes: ArrayBuffer, expectedFramework: string) {
  const entries = readZipEntries(bytes);
  const originalPaths = entries.map((entry) => entry.path).filter(Boolean);
  const paths = stripCommonRoot(originalPaths);
  const rootPrefix = originalPaths.length && originalPaths[0] !== paths[0] ? originalPaths[0].slice(0, originalPaths[0].length - paths[0].length) : "";
  const entryFor = (path: string) => entries.find((entry) => entry.path === `${rootPrefix}${path}`);
  const has = (value: string) => paths.includes(value);
  const hasDirectory = (value: string) => paths.some((path) => path.startsWith(value));
  const isLaravel = has("artisan") && has("composer.json") && hasDirectory("app/") && hasDirectory("public/");
  const isPhp = has("index.php") || has("public/index.php");
  if (expectedFramework === "Laravel" && !isLaravel) throw new Error("ZIP Laravel wajib memuat artisan, composer.json, app/, dan public/.");
  if (expectedFramework === "PHP Native" && !isPhp) throw new Error("ZIP PHP wajib memuat index.php atau public/index.php.");
  const warnings: string[] = [];
  const composer = entryFor("composer.json");
  const packageJson = entryFor("package.json");
  const envExample = has(".env.example");
  const hasMigrations = hasDirectory("database/migrations/");
  let phpVersion: string | null = null;
  let laravelVersion: string | null = null;
  let hasBuildScript = false;
  if (composer && composer.uncompressedSize <= 512 * 1024) {
    try {
      const parsed = JSON.parse(await readEntry(bytes, composer)) as { require?: Record<string, string> };
      phpVersion = parsed.require?.php ?? null;
      laravelVersion = parsed.require?.["laravel/framework"] ?? null;
    } catch { warnings.push("composer.json tidak dapat dibaca sebagai JSON."); }
  }
  if (packageJson && packageJson.uncompressedSize <= 512 * 1024) {
    try {
      const parsed = JSON.parse(await readEntry(bytes, packageJson)) as { scripts?: Record<string, string> };
      hasBuildScript = Boolean(parsed.scripts?.build);
    } catch { warnings.push("package.json tidak dapat dibaca sebagai JSON."); }
  }
  if (isLaravel && !envExample) warnings.push(".env.example tidak ditemukan; worker perlu memakai template environment bawaan.");
  if (isLaravel && !hasMigrations) warnings.push("Tidak ada database/migrations; tabel aplikasi tidak akan dibuat otomatis.");
  if (isLaravel && !laravelVersion) warnings.push("Dependensi laravel/framework tidak ditemukan di composer.json.");
  if (packageJson && !hasBuildScript) warnings.push("package.json tersedia tanpa script build; aset frontend tidak akan dibangun otomatis.");
  if (paths.some((path) => path === ".env" || path.endsWith("/.env"))) warnings.push("ZIP memuat .env. Nilai rahasia dari file tersebut akan diabaikan saat deployment.");
  return { detectedFramework: isLaravel ? "Laravel" : "PHP Native", files: paths.length, readiness: warnings.length ? "Warning" : "Ready", warnings, requirements: { composer: Boolean(composer), phpVersion, laravelVersion, envExample, migrations: hasMigrations, packageJson: Boolean(packageJson), buildScript: hasBuildScript } };
}
