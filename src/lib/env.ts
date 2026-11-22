import { getCloudflareContext } from "@opennextjs/cloudflare";
import { S3Bucket } from "./s3-bucket";

export type NotifyMessage = { type: "email"; outboxId: string } | { type: "appetize"; previewId: string };

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
  /** Optional S3-compatible storage (e.g. Supabase Storage). When set it is used instead of the R2 binding. */
  STORAGE_S3_ENDPOINT?: string;
  STORAGE_S3_REGION?: string;
  STORAGE_S3_BUCKET?: string;
  STORAGE_S3_ACCESS_KEY_ID?: string;
  STORAGE_S3_SECRET_ACCESS_KEY?: string;
  /** Appetize.io REST API token (secret). Never sent to the browser. */
  APPETIZE_API_TOKEN?: string;
  /** Optional override of the Appetize API base URL (private/enterprise instances, tests). */
  APPETIZE_API_BASE?: string;
}

let testEnv: AppEnv | null = null;
/** Test hook: inject fake bindings. Never used in production code paths. */
export function __setTestEnv(env: AppEnv | null) {
  testEnv = env;
}

const withStorage = new WeakMap<object, AppEnv>();

/** Use S3-compatible storage (Supabase) when configured; otherwise the Cloudflare R2 binding. */
export function resolveStorage(env: AppEnv): AppEnv {
  const { STORAGE_S3_ENDPOINT: endpoint, STORAGE_S3_BUCKET: bucket, STORAGE_S3_ACCESS_KEY_ID: accessKeyId, STORAGE_S3_SECRET_ACCESS_KEY: secretAccessKey } = env;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return env;
  const cached = withStorage.get(env);
  if (cached) return cached;
  const next = { ...env, BUCKET: new S3Bucket({ endpoint, bucket, accessKeyId, secretAccessKey, region: env.STORAGE_S3_REGION || "us-east-1" }) as unknown as R2Bucket } as AppEnv;
  withStorage.set(env, next);
  return next;
}

export async function getEnv(): Promise<AppEnv> {
  if (testEnv) return testEnv;
  const ctx = await getCloudflareContext({ async: true });
  return resolveStorage(ctx.env as unknown as AppEnv);
}

export function isSecure(env: AppEnv): boolean {
  // In local development the same session must also work on http://127.0.0.1.
  return env.APP_URL.startsWith("https://") && env.ENVIRONMENT !== "development";
}
