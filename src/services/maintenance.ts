import type { AppEnv } from "@/lib/env";
import { all, run, one } from "@/lib/db";
import { addDays, addSeconds, nowIso } from "@/lib/time";
import { reclaimExpiredLeases } from "./worker";
import { purgeRateLimits } from "@/lib/ratelimit";
import { getSettings } from "@/lib/settings";
import { deliverOutbox } from "@/lib/email";
import { notify } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { runDuePreviews } from "./simulator";

const BUILD_PURGE_AFTER_DAYS = 30;

/** Frequent job (every 5 min): lease recovery, upload expiry, link expiry warnings, email retries. */
export async function runFrequent(env: AppEnv) {
  const reclaimed = await reclaimExpiredLeases(env);
  const now = nowIso();
  try { await runDuePreviews(env); } catch (e) { console.error("simulator preview run failed", (e as Error).message); }

  // Expire stale upload sessions and abort their multipart uploads so no orphaned parts accrue storage.
  const stale = await all<{ id: string; r2_object_key: string; multipart_upload_id: string | null; status: string }>(env.DB,
    "SELECT id, r2_object_key, multipart_upload_id, status FROM upload_sessions WHERE status IN ('open','completing','failed') AND expires_at < ?", now);
  for (const s of stale) {
    try { if (s.multipart_upload_id && s.status !== "failed") await env.BUCKET.resumeMultipartUpload(s.r2_object_key, s.multipart_upload_id).abort(); } catch { /* already gone */ }
    await run(env.DB, "UPDATE upload_sessions SET status = 'expired' WHERE id = ?", s.id);
  }
  // Completed uploads that never became a build are orphans after 24h.
  const orphans = await all<{ id: string; r2_object_key: string }>(env.DB,
    "SELECT s.id, s.r2_object_key FROM upload_sessions s WHERE s.status = 'completed' AND s.completed_at < ? AND NOT EXISTS (SELECT 1 FROM builds b WHERE b.id = s.build_id)", addSeconds(-86400));
  for (const o of orphans) {
    await env.BUCKET.delete(o.r2_object_key);
    await run(env.DB, "UPDATE upload_sessions SET status = 'expired' WHERE id = ?", o.id);
  }
  // Pending attachments that were never uploaded.
  await run(env.DB, "UPDATE feedback_attachments SET status = 'rejected' WHERE status = 'pending' AND created_at < ?", addSeconds(-3600));

  // Warn link creators/members about links expiring within 24h (once per link).
  const expiring = await all<{ id: string; title: string; organisation_id: string; created_by: string | null }>(env.DB,
    `SELECT l.id, l.title, l.organisation_id, l.created_by FROM distribution_links l WHERE l.status = 'active' AND l.expires_at IS NOT NULL AND l.expires_at > ? AND l.expires_at < ?
       AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.type = 'link_expiring' AND n.resource_id = l.id)`, now, addDays(1));
  for (const l of expiring) {
    if (l.created_by) await notify(env, { userIds: [l.created_by], organisationId: l.organisation_id, type: "link_expiring", title: `Distribution link expiring within 24h: ${l.title}`, resourceType: "distribution_link", resourceId: l.id, path: `/app/distribution/${l.id}` });
  }
  // Retry queued emails (covers deployments without a Queue binding or failed deliveries).
  const queued = await all<{ id: string }>(env.DB, "SELECT id FROM email_outbox WHERE status = 'queued' AND created_at < ? LIMIT 25", addSeconds(-120));
  for (const q of queued) await deliverOutbox(env, q.id).catch(() => undefined);
  return { reclaimed, expiredSessions: stale.length, orphans: orphans.length, expiringLinks: expiring.length };
}

/** Daily job: retention, session cleanup, hard purge of soft-deleted builds. */
export async function runDaily(env: AppEnv) {
  const s = await getSettings(env);
  await purgeRateLimits(env);
  const now = nowIso();
  await run(env.DB, "DELETE FROM login_sessions WHERE expires_at < ? OR revoked_at < ?", now, addDays(-7));
  await run(env.DB, "DELETE FROM invitations WHERE expires_at < ? AND accepted_at IS NULL", addDays(-30));
  await run(env.DB, "DELETE FROM password_resets WHERE expires_at < ?", addDays(-1));
  await run(env.DB, "DELETE FROM downloads WHERE created_at < ?", addDays(-s.downloadEventRetentionDays));
  await run(env.DB, "DELETE FROM audit_logs WHERE created_at < ?", addDays(-s.auditRetentionDays));
  await run(env.DB, "DELETE FROM email_outbox WHERE status IN ('sent','not_configured') AND created_at < ?", addDays(-30));

  const doomed = await all<{ id: string; organisation_id: string }>(env.DB, "SELECT id, organisation_id FROM builds WHERE deleted_at IS NOT NULL AND deleted_at < ?", addDays(-BUILD_PURGE_AFTER_DAYS));
  for (const b of doomed) {
    const files = await all<{ r2_object_key: string }>(env.DB, "SELECT r2_object_key FROM build_files WHERE build_id = ?", b.id);
    for (const f of files) await env.BUCKET.delete(f.r2_object_key);
    await run(env.DB, "DELETE FROM builds WHERE id = ?", b.id);
    await audit(env, { organisationId: b.organisation_id, actorType: "system", action: "build.purged", resourceType: "build", resourceId: b.id });
  }
  return { purgedBuilds: doomed.length, remainingDeleted: (await one<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM builds WHERE deleted_at IS NOT NULL"))?.n ?? 0 };
}
