import { getCloudflareContext } from "@opennextjs/cloudflare";

export type NotifyMessage = { type: "email"; outboxId: string };

export interface AppEnv {
  DB: D1Database;
  BUCKET: R2Bucket;
  NOTIFY_QUEUE?: Queue<NotifyMessage>;
  APP_URL: string;
  ENVIRONMENT?: string;
  URL_SIGNING_SECRET: string;
  BOOTSTRAP_OWNER_EMAIL?: string;
  BOOTSTRAP_OWNER_PASSWORD?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  EMAIL_PROVIDER?: string; // none | resend (see docs/operations.md)
  EMAIL_FROM_ADDRESS?: string;
  EMAIL_FROM_NAME?: string;
  EMAIL_API_KEY?: string;
}

let testEnv: AppEnv | null = null;
/** Test hook: inject fake bindings. Never used in production code paths. */
export function __setTestEnv(env: AppEnv | null) {
  testEnv = env;
}

export async function getEnv(): Promise<AppEnv> {
  if (testEnv) return testEnv;
  const ctx = await getCloudflareContext({ async: true });
  return ctx.env as unknown as AppEnv;
}

export function isSecure(env: AppEnv): boolean {
  // In local development the same session must also work on http://127.0.0.1.
  return env.APP_URL.startsWith("https://") && env.ENVIRONMENT !== "development";
}
