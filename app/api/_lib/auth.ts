import { ensureDatabase, getD1 } from "@/db/bootstrap";

export type PanelRole = "Administrator" | "Operator" | "Viewer";
export type SessionUser = { id: string; name: string; email: string; role: PanelRole; status: "Active" | "Disabled" };

const sessionCookie = "nexdeploy_session";
const encoder = new TextEncoder();
const maxLoginAttempts = 5;
const loginLockDurationMs = 15 * 60 * 1000;

function toBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

async function digest(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toBase64(new Uint8Array(hash));
}

async function passwordHash(password: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(salt), iterations: 120000, hash: "SHA-256" }, key, 256);
  return toBase64(new Uint8Array(bits));
}

export async function createPasswordHash(password: string) {
  const salt = crypto.randomUUID();
  return `${salt}:${await passwordHash(password, salt)}`;
}

export async function verifyPassword(password: string, saved: string) {
  const [salt, expected] = saved.split(":");
  return Boolean(salt && expected) && (await passwordHash(password, salt)) === expected;
}

function loginAttemptKey(request: Request, email: string) {
  const address = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  return `${email.trim().toLowerCase()}:${address}`;
}

export async function login(request: Request, email: string, password: string) {
  await ensureDatabase();
  const db = getD1();
  const key = loginAttemptKey(request, email);
  const now = new Date();
  const attempt = await db.prepare("SELECT attempts, locked_until FROM login_attempts WHERE key = ?").bind(key).first<{ attempts: number; locked_until: string | null }>();
  if (attempt?.locked_until && new Date(attempt.locked_until) > now) {
    return { error: "Terlalu banyak percobaan gagal. Coba lagi setelah 15 menit.", locked: true };
  }
  if (attempt?.locked_until) await db.prepare("DELETE FROM login_attempts WHERE key = ?").bind(key).run();
  const user = await db.prepare("SELECT id, name, email, password_hash, role, status FROM users WHERE lower(email) = lower(?)").bind(email.trim()).first<{ id: string; name: string; email: string; password_hash: string; role: PanelRole; status: "Active" | "Disabled" }>();
  if (!user || user.status !== "Active" || !(await verifyPassword(password, user.password_hash))) {
    const failures = (attempt?.locked_until ? 0 : attempt?.attempts ?? 0) + 1;
    const lockedUntil = failures >= maxLoginAttempts ? new Date(now.getTime() + loginLockDurationMs).toISOString() : null;
    await db.prepare("INSERT INTO login_attempts (key, attempts, locked_until, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET attempts = excluded.attempts, locked_until = excluded.locked_until, updated_at = excluded.updated_at")
      .bind(key, failures, lockedUntil, now.toISOString()).run();
    return { error: lockedUntil ? "Terlalu banyak percobaan gagal. Coba lagi setelah 15 menit." : `Email atau password tidak sesuai. Sisa percobaan: ${maxLoginAttempts - failures}.`, locked: Boolean(lockedUntil) };
  }
  await db.prepare("DELETE FROM login_attempts WHERE key = ?").bind(key).run();
  await db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(now.toISOString(), user.id).run();
  const token = crypto.randomUUID() + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  await db.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), user.id, await digest(token), expiresAt, new Date().toISOString()).run();
  return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status } };
}

export async function currentUser(request: Request): Promise<SessionUser | null> {
  await ensureDatabase();
  const token = request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1);
  if (!token) return null;
  const row = await getD1().prepare("SELECT users.id, users.name, users.email, users.role, users.status FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.status = 'Active'")
    .bind(await digest(token), new Date().toISOString()).first<SessionUser>();
  return row ?? null;
}

export async function requireUser(request: Request) {
  const user = await currentUser(request);
  if (!user) throw new Response(JSON.stringify({ error: "Sesi tidak ditemukan. Silakan masuk kembali." }), { status: 401, headers: { "content-type": "application/json" } });
  return user;
}

export async function clearSession(request: Request) {
  const token = request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1);
  if (token) await getD1().prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await digest(token)).run();
}

export async function changePassword(request: Request, currentPassword: string, nextPassword: string) {
  const user = await requireUser(request);
  const record = await getD1().prepare("SELECT password_hash FROM users WHERE id = ?").bind(user.id).first<{ password_hash: string }>();
  if (!record || !(await verifyPassword(currentPassword, record.password_hash))) return { error: "Password saat ini tidak sesuai." };
  const nextHash = await createPasswordHash(nextPassword);
  await getD1().batch([
    getD1().prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(nextHash, user.id),
    getD1().prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
  ]);
  return { ok: true };
}

export const sessionCookieName = sessionCookie;
