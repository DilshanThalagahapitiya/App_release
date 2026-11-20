import type { AppEnv } from "./env";
import { isSecure } from "./env";
import { one, run, all } from "./db";
import { hashToken, newId, randomToken, verifyPassword } from "./crypto";
import { addDays, addSeconds, nowIso } from "./time";
import { ApiError } from "./errors";
import { rateLimit, clientIp } from "./ratelimit";
import { audit } from "./audit";

export const SESSION_COOKIE = "ipa_session";
const SESSION_DAYS = 14;
const IDLE_REFRESH_MS = 5 * 60 * 1000;

export interface Actor {
  userId: string;
  email: string;
  displayName: string;
  isPlatformOwner: boolean;
  sessionId: string;
}

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookieHeader(env: AppEnv, name: string, value: string, maxAgeSec: number, path = "/"): string {
  const secure = isSecure(env) ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}
export const clearCookie = (env: AppEnv, name: string, path = "/") => cookieHeader(env, name, "", 0, path);

export async function createSession(env: AppEnv, userId: string) {
  const token = randomToken(32);
  const id = newId();
  const now = nowIso();
  await run(env.DB, "INSERT INTO login_sessions (id, user_id, session_token_hash, expires_at, last_seen_at, created_at) VALUES (?,?,?,?,?,?)",
    id, userId, await hashToken(token), addDays(SESSION_DAYS), now, now);
  return { token, id, maxAge: SESSION_DAYS * 86400 };
}

export async function actorFromToken(env: AppEnv, token: string | undefined): Promise<Actor | null> {
  if (!token) return null;
  const row = await one<{ sid: string; last_seen_at: string; id: string; email: string; display_name: string; is_platform_owner: number }>(
    env.DB,
    `SELECT s.id AS sid, s.last_seen_at, u.id, u.email, u.display_name, u.is_platform_owner
       FROM login_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.session_token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status = 'active'`,
    await hashToken(token), nowIso(),
  );
  if (!row) return null;
  if (Date.now() - new Date(row.last_seen_at).getTime() > IDLE_REFRESH_MS) {
    await run(env.DB, "UPDATE login_sessions SET last_seen_at = ? WHERE id = ?", nowIso(), row.sid);
  }
  return { userId: row.id, email: row.email, displayName: row.display_name, isPlatformOwner: !!row.is_platform_owner, sessionId: row.sid };
}

export async function actorFromRequest(env: AppEnv, req: Request): Promise<Actor | null> {
  return actorFromToken(env, parseCookies(req)[SESSION_COOKIE]);
}

export async function revokeSession(env: AppEnv, sessionId: string) {
  await run(env.DB, "UPDATE login_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", nowIso(), sessionId);
}
export async function revokeAllSessions(env: AppEnv, userId: string) {
  await run(env.DB, "UPDATE login_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", nowIso(), userId);
}

export async function verifyTurnstile(env: AppEnv, token: string | undefined, req: Request): Promise<void> {
  if (!env.TURNSTILE_SECRET_KEY) return; // not configured: documented, WAF + D1 throttling still apply
  if (!token) throw new ApiError("VALIDATION_ERROR", "Please complete the bot-protection challenge.");
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: clientIp(req) });
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const j = (await res.json().catch(() => ({}))) as { success?: boolean };
  if (!j.success) throw new ApiError("VALIDATION_ERROR", "Bot-protection challenge failed. Please retry.");
}

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

/** Email+password login with throttling. Failure responses are identical for unknown/disabled/locked accounts. */
export async function login(env: AppEnv, req: Request, email: string, password: string) {
  const ip = clientIp(req);
  await rateLimit(env, `login:ip:${ip}`, 30, 300);
  await rateLimit(env, `login:email:${email}`, 10, 300);
  const user = await one<{ id: string; password_hash: string | null; status: string; failed_login_count: number; locked_until: string | null }>(
    env.DB, "SELECT id, password_hash, status, failed_login_count, locked_until FROM users WHERE email = ?", email);
  const locked = !!user?.locked_until && user.locked_until > nowIso();
  const passwordOk = await verifyPassword(password, user?.password_hash ?? null);
  if (!user || user.status !== "active" || locked || !passwordOk) {
    if (user && !locked && user.status === "active") {
      const fails = user.failed_login_count + 1;
      await run(env.DB, "UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?", fails,
        fails >= MAX_FAILS ? addSeconds(LOCK_MINUTES * 60) : null, user.id);
    }
    await audit(env, { actorType: "anonymous", action: "auth.login_failed", resourceType: "user", resourceId: user?.id, req });
    throw new ApiError("INVALID_CREDENTIALS", "Invalid email or password.");
  }
  await run(env.DB, "UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), user.id);
  const session = await createSession(env, user.id);
  await audit(env, { actorUserId: user.id, action: "auth.login", resourceType: "user", resourceId: user.id, req });
  return { userId: user.id, ...session };
}

export async function listSessions(env: AppEnv, userId: string) {
  return all(env.DB, "SELECT id, created_at, last_seen_at, expires_at FROM login_sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC", userId, nowIso());
}
