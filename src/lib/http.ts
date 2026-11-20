import { z, ZodError, type ZodType } from "zod";
import { getEnv, type AppEnv } from "./env";
import { ApiError } from "./errors";
import { actorFromRequest, type Actor } from "./auth";
import { hashToken } from "./crypto";
import { one } from "./db";
import { rateLimit, clientIp } from "./ratelimit";

export interface WorkerIdentity {
  id: string;
  name: string;
}

export interface Ctx {
  req: Request;
  env: AppEnv;
  url: URL;
  params: Record<string, string>;
  requestId: string;
  actor: Actor | null;
  worker: WorkerIdentity | null;
  /** Parse + validate the JSON body (max 1 MiB). */
  body<T extends ZodType>(schema: T): Promise<z.infer<T>>;
  /** Parse + validate query string. */
  query<T extends ZodType>(schema: T): z.infer<T>;
  /** Actor or throw 401. */
  user(): Actor;
}

export class Created<T> {
  constructor(public data: T) {}
}
export class NoContent {}

type Handler = (c: Ctx) => Promise<unknown | Response>;
export interface ApiOptions {
  auth?: "user" | "public" | "worker";
  /** [bucket-name, limit, windowSeconds] — bucket is combined with client IP. */
  rate?: [string, number, number];
  /** Skip the cross-site request check (only for GET-like or token-authenticated endpoints). */
  noCsrf?: boolean;
}

const MAX_JSON_BYTES = 1024 * 1024;

export function jsonResponse(status: number, payload: unknown, requestId: string, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-request-id": requestId, ...headers },
  });
}

export function sameOrigin(req: Request, env: AppEnv): boolean {
  const origin = req.headers.get("origin");
  const expected = new URL(env.APP_URL).origin;
  if (origin) return origin === expected;
  const site = req.headers.get("sec-fetch-site");
  return site === "same-origin" || site === "none";
}

export async function workerFromRequest(env: AppEnv, req: Request): Promise<WorkerIdentity | null> {
  const h = req.headers.get("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  const token = h.slice(7).trim();
  if (token.length < 20) return null;
  const row = await one<{ id: string; name: string }>(env.DB, "SELECT id, name FROM worker_registry WHERE token_hash = ? AND status = 'active' AND revoked_at IS NULL", await hashToken(token));
  return row ?? null;
}

export function api(handler: Handler, opts: ApiOptions = {}) {
  const auth = opts.auth ?? "user";
  return async (req: Request, route?: { params?: Promise<Record<string, string>> }): Promise<Response> => {
    const requestId = crypto.randomUUID();
    try {
      const env = await getEnv();
      const params = (await route?.params) ?? {};
      const url = new URL(req.url);
      if (opts.rate) await rateLimit(env, `${opts.rate[0]}:${clientIp(req)}`, opts.rate[1], opts.rate[2]);

      let actor: Actor | null = null;
      let worker: WorkerIdentity | null = null;
      if (auth === "worker") {
        worker = await workerFromRequest(env, req);
        if (!worker) throw new ApiError("UNAUTHENTICATED", "Invalid worker credentials.");
        await rateLimit(env, `worker:${worker.id}`, 600, 60);
      } else {
        actor = await actorFromRequest(env, req);
        if (auth === "user" && !actor) throw new ApiError("UNAUTHENTICATED", "Please sign in.");
        const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
        if (mutating && !opts.noCsrf && !sameOrigin(req, env)) throw new ApiError("FORBIDDEN", "Cross-site request rejected.");
      }

      const ctx: Ctx = {
        req, env, url, params, requestId, actor, worker,
        async body(schema) {
          const len = Number(req.headers.get("content-length") ?? 0);
          if (len > MAX_JSON_BYTES) throw new ApiError("PAYLOAD_TOO_LARGE", "Request body is too large.");
          const text = await req.text();
          if (text.length > MAX_JSON_BYTES) throw new ApiError("PAYLOAD_TOO_LARGE", "Request body is too large.");
          let raw: unknown = {};
          if (text) {
            try { raw = JSON.parse(text); } catch { throw new ApiError("BAD_REQUEST", "Body must be valid JSON."); }
          }
          return parse(schema, raw);
        },
        query(schema) {
          return parse(schema, Object.fromEntries(url.searchParams));
        },
        user() {
          if (!actor) throw new ApiError("UNAUTHENTICATED", "Please sign in.");
          return actor;
        },
      };

      const result = await handler(ctx);
      if (result instanceof Response) {
        result.headers.set("x-request-id", requestId);
        return result;
      }
      if (result instanceof NoContent) return new Response(null, { status: 204, headers: { "x-request-id": requestId } });
      const status = result instanceof Created ? 201 : 200;
      const data = result instanceof Created ? result.data : result;
      return jsonResponse(status, { data, meta: { requestId } }, requestId);
    } catch (e) {
      return errorResponse(e, requestId);
    }
  };
}

export function parse<T extends ZodType>(schema: T, raw: unknown): z.infer<T> {
  const r = schema.safeParse(raw);
  if (!r.success) throw zodToApi(r.error);
  return r.data;
}

function zodToApi(e: ZodError) {
  return new ApiError("VALIDATION_ERROR", "The submitted data is invalid.", e.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
}

export function errorResponse(e: unknown, requestId: string): Response {
  if (e instanceof ApiError) {
    const headers: Record<string, string> = {};
    if (e.code === "RATE_LIMITED" && e.details && typeof e.details === "object" && "retryAfterSeconds" in e.details)
      headers["retry-after"] = String((e.details as { retryAfterSeconds: number }).retryAfterSeconds);
    return jsonResponse(e.status, { error: { code: e.code, message: e.message, details: e.details ?? [] }, meta: { requestId } }, requestId, headers);
  }
  // Never leak internals (stack traces, SQL, bindings) to the client.
  console.error("unhandled_error", requestId, e instanceof Error ? `${e.name}: ${e.message}` : e);
  return jsonResponse(500, { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred.", details: [] }, meta: { requestId } }, requestId);
}
