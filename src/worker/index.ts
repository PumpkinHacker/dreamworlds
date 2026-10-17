import { Hono } from "hono";

type Bindings = { DB: D1Database; ADMIN_TOKEN?: string };
type Account = { id: number; username: string; salt: string; password_hash: string; session_token_hash: string | null; expires_at: number };

const app = new Hono<{ Bindings: Bindings }>();
const jsonError = (message: string, status: 400 | 401 | 409 | 500) => new Response(JSON.stringify({ error: message }), { status, headers: { "Content-Type": "application/json" } });
const enc = new TextEncoder();
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
const randomHex = (size: number) => { const bytes = new Uint8Array(size); crypto.getRandomValues(bytes); return hex(bytes.buffer); };
const sha256 = async (value: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(value)));
async function hashPassword(password: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 120000 }, key, 256));
}
async function ensureTables(db: D1Database) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS players (player_id TEXT PRIMARY KEY, coins INTEGER NOT NULL DEFAULT 0 CHECK(coins >= 0))"),
    db.prepare("CREATE TABLE IF NOT EXISTS announcements (id INTEGER PRIMARY KEY CHECK(id=1), message TEXT NOT NULL DEFAULT '')"),
    db.prepare("CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE, salt TEXT NOT NULL, password_hash TEXT NOT NULL, session_token_hash TEXT, expires_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_accounts_session ON accounts(session_token_hash)"),
    db.prepare("INSERT OR IGNORE INTO announcements (id, message) VALUES (1, '')")
  ]);
}
async function currentAccount(c: any): Promise<Account | null> {
  const token = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || token.length > 200) return null;
  const row = await c.env.DB.prepare("SELECT id, username, salt, password_hash, session_token_hash, expires_at FROM accounts WHERE session_token_hash = ?").bind(await sha256(token)).first<Account>();
  if (!row || row.expires_at < Math.floor(Date.now() / 1000)) return null;
  return row;
}
async function playerPayload(db: D1Database, username: string) {
  const player = await db.prepare("SELECT player_id, coins FROM players WHERE player_id = ?").bind(username).first<{ player_id: string; coins: number }>();
  return { playerId: username, username, coins: player?.coins ?? 0 };
}

app.get("/api/health", c => c.json({ ok: true, service: "Dream World API" }));
app.post("/api/auth/register", async c => {
  await ensureTables(c.env.DB);
  const body = await c.req.json<{ username?: string; password?: string }>().catch(() => ({}));
  const username = body.username?.trim() ?? "";
  const password = body.password ?? "";
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return jsonError("Username must be 3–20 letters, numbers, or underscores.", 400);
  if (password.length < 8 || password.length > 128) return jsonError("Password must be between 8 and 128 characters.", 400);
  const salt = randomHex(16);
  const password_hash = await hashPassword(password, salt);
  try {
    await c.env.DB.prepare("INSERT INTO accounts (username, salt, password_hash, created_at) VALUES (?, ?, ?, ?)").bind(username, salt, password_hash, Math.floor(Date.now() / 1000)).run();
  } catch {
    return jsonError("That username is already taken. Try another one.", 409);
  }
  await c.env.DB.prepare("INSERT OR IGNORE INTO players (player_id, coins) VALUES (?, 0)").bind(username).run();
  const token = randomHex(32);
  const expires = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  await c.env.DB.prepare("UPDATE accounts SET session_token_hash = ?, expires_at = ? WHERE username = ?").bind(await sha256(token), expires, username).run();
  return c.json({ token, player: await playerPayload(c.env.DB, username) }, 201);
});
app.post("/api/auth/login", async c => {
  await ensureTables(c.env.DB);
  const body = await c.req.json<{ username?: string; password?: string }>().catch(() => ({}));
  const username = body.username?.trim() ?? "";
  const password = body.password ?? "";
  if (!username || !password || password.length > 128) return jsonError("Enter your username and password.", 400);
  const account = await c.env.DB.prepare("SELECT id, username, salt, password_hash, session_token_hash, expires_at FROM accounts WHERE username = ?").bind(username).first<Account>();
  if (!account || (await hashPassword(password, account.salt)) !== account.password_hash) return jsonError("Username or password is incorrect.", 401);
  const token = randomHex(32);
  const expires = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  await c.env.DB.prepare("UPDATE accounts SET session_token_hash = ?, expires_at = ? WHERE id = ?").bind(await sha256(token), expires, account.id).run();
  await c.env.DB.prepare("INSERT OR IGNORE INTO players (player_id, coins) VALUES (?, 0)").bind(account.username).run();
  return c.json({ token, player: await playerPayload(c.env.DB, account.username) });
});
app.get("/api/auth/me", async c => {
  await ensureTables(c.env.DB);
  const account = await currentAccount(c);
  if (!account) return jsonError("Your session expired. Please log in again.", 401);
  return c.json({ player: await playerPayload(c.env.DB, account.username) });
});
app.get("/api/player/state", async c => {
  await ensureTables(c.env.DB);
  const account = await currentAccount(c);
  if (!account) return jsonError("Please log in again.", 401);
  const player = await playerPayload(c.env.DB, account.username);
  const announcement = await c.env.DB.prepare("SELECT message FROM announcements WHERE id = 1").first<{ message: string }>();
  return c.json({ player, announcement: { message: announcement?.message ?? "" } });
});
app.post("/api/auth/logout", async c => {
  await ensureTables(c.env.DB);
  const account = await currentAccount(c);
  if (account) await c.env.DB.prepare("UPDATE accounts SET session_token_hash = NULL, expires_at = 0 WHERE id = ?").bind(account.id).run();
  return c.json({ ok: true });
});
app.notFound(c => c.json({ error: "Route not found." }, 404));
app.onError((error, c) => {
  console.error("Dream World API error", error);
  return c.json({ error: "The server had a problem. Please try again." }, 500);
});
export default app;
