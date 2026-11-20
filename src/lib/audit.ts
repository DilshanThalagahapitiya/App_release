import type { AppEnv } from "./env";
import { run } from "./db";
import { newId } from "./crypto";
import { nowIso } from "./time";
import { ipHash } from "./ratelimit";

export interface AuditInput {
  organisationId?: string | null;
  actorUserId?: string | null;
  actorType?: "user" | "worker" | "system" | "anonymous";
  action: string;
  resourceType?: string;
  resourceId?: string;
  /** Never put secrets, tokens, signed URLs, or provisioning data in metadata. */
  metadata?: Record<string, unknown>;
  req?: Request;
}

export async function audit(env: AppEnv, a: AuditInput): Promise<void> {
  try {
    await run(
      env.DB,
      "INSERT INTO audit_logs (id, organisation_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata_json, ip_hash, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      newId(), a.organisationId ?? null, a.actorUserId ?? null, a.actorType ?? (a.actorUserId ? "user" : "anonymous"),
      a.action, a.resourceType ?? null, a.resourceId ?? null, a.metadata ? JSON.stringify(a.metadata) : null,
      a.req ? await ipHash(env, a.req) : null, nowIso(),
    );
  } catch (e) {
    // Auditing must never take the request down, but failures must be visible in logs.
    console.error("audit_write_failed", a.action, e instanceof Error ? e.message : e);
  }
}
