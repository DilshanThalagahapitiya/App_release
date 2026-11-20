import { __setTestEnv, type AppEnv } from "@/lib/env";
import { hashPassword, newId, sha256Hex } from "@/lib/crypto";
import { nowIso } from "@/lib/time";
import { createD1 } from "./d1";
import { createR2 } from "./r2";

export const APP_URL = "https://portal.test";

export function setupEnv(overrides: Partial<AppEnv> = {}) {
  const env: AppEnv = { DB: createD1(), BUCKET: createR2(), APP_URL, URL_SIGNING_SECRET: "test-secret-test-secret-test-secret", ENVIRONMENT: "test", ...overrides };
  __setTestEnv(env);
  return env;
}

export async function insertUser(env: AppEnv, email: string, password = "correct horse battery", opts: { owner?: boolean; name?: string } = {}) {
  const id = newId(); const now = nowIso();
  await env.DB.prepare("INSERT INTO users (id, email, display_name, password_hash, email_verified_at, is_platform_owner, status, created_at, updated_at) VALUES (?,?,?,?,?,?,'active',?,?)")
    .bind(id, email, opts.name ?? email.split("@")[0], await hashPassword(password), now, opts.owner ? 1 : 0, now, now).run();
  return id;
}

type RouteFn = (req: Request, ctx?: { params?: Promise<Record<string, string>> }) => Promise<Response>;
export interface CallOpts { method?: string; params?: Record<string, string>; body?: unknown; rawBody?: BodyInit; cookie?: string; headers?: Record<string, string>; query?: Record<string, string>; origin?: string | null; path?: string }

export async function call(handler: RouteFn, opts: CallOpts = {}) {
  const url = new URL(opts.path ?? "/api/test", APP_URL);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.origin !== null) headers.origin = opts.origin ?? APP_URL;
  let body: BodyInit | undefined = opts.rawBody;
  if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers["content-type"] = "application/json"; }
  if (body !== undefined && !headers["content-length"] && typeof body === "string") headers["content-length"] = String(new TextEncoder().encode(body).length);
  const method = opts.method ?? (body !== undefined ? "POST" : "GET");
  const res = await handler(new Request(url, { method, headers, body, redirect: "manual" }), { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers, data: json?.data, error: json?.error };
}

export function cookieFrom(res: { headers: Headers }): string {
  const sc = res.headers.getSetCookie?.() ?? [];
  const c = sc.find((x) => x.startsWith("ipa_session="));
  if (!c) throw new Error("no session cookie");
  return c.split(";")[0];
}

export async function sha256OfBytes(b: Uint8Array) { return sha256Hex(b); }

/** Builds a tiny byte payload that begins with the ZIP magic. TEST FIXTURE — not a real IPA. */
export function fakeIpaBytes(size = 1024): Uint8Array {
  const b = new Uint8Array(size);
  b.set([0x50, 0x4b, 0x03, 0x04]);
  for (let i = 4; i < size; i++) b[i] = (i * 31) & 0xff;
  return b;
}
