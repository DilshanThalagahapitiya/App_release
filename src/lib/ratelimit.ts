import type { AppEnv } from "./env";
import { ApiError } from "./errors";
import { one, run } from "./db";
import { sha256Hex } from "./crypto";

/**
 * Fixed-window counter in D1. This is an application-level safety net; production should ALSO
 * configure Cloudflare WAF rate-limiting rules (docs/cloudflare-deployment.md) which stop abuse
 * before it reaches the Worker.
 */
export async function rateLimit(env: AppEnv, bucket: string, limit: number, windowSec: number): Promise<void> {
  const windowStart = Math.floor(Date.now() / 1000 / windowSec) * windowSec;
  const row = await one<{ count: number }>(
    env.DB,
    "INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, 1) ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1 RETURNING count",
    bucket, windowStart,
  );
  if (row && row.count > limit) {
    throw new ApiError("RATE_LIMITED", "Too many requests. Please wait and try again.", { retryAfterSeconds: windowStart + windowSec - Math.floor(Date.now() / 1000) });
  }
}

export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/** Raw IPs are never stored; a salted hash allows abuse correlation without retaining the address. */
export async function ipHash(env: AppEnv, req: Request): Promise<string> {
  return (await sha256Hex(`${env.URL_SIGNING_SECRET}|ip|${clientIp(req)}`)).slice(0, 32);
}

export async function purgeRateLimits(env: AppEnv) {
  await run(env.DB, "DELETE FROM rate_limits WHERE window_start < ?", Math.floor(Date.now() / 1000) - 86400);
}
