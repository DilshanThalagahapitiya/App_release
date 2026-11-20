import type { AppEnv } from "@/lib/env";
import type { Actor } from "@/lib/auth";
import { all, one, run, stmt, batch, parseJson } from "@/lib/db";
import { ApiError, forbidden, notFound } from "@/lib/errors";
import { hashToken, newId, randomToken, timingSafeEqual } from "@/lib/crypto";
import { addSeconds, nowIso } from "@/lib/time";
import { audit } from "@/lib/audit";
import { validationReportSchema, type ValidationReport, type Eligibility } from "@/lib/report-schema";
import { assessEligibility, moreConservative } from "@/lib/eligibility";
import { keys, signedFileUrl } from "@/lib/storage";
import { notify, projectStaffIds } from "@/lib/notify";
import { parse } from "@/lib/http";
import type { BuildRow, ProjectRow } from "@/lib/types";

const LEASE_SECONDS = 300;
export const WORKER_ONLINE_WINDOW_SECONDS = 120;

// ---------------------------------------------------------------- registry (Platform Owner)

export async function registerWorker(env: AppEnv, actor: Actor, name: string, req?: Request) {
  if (!actor.isPlatformOwner) throw forbidden("Only the Platform Owner can register workers.");
  const token = "wkr_" + randomToken(32);
  const id = newId();
  await run(env.DB, "INSERT INTO worker_registry (id, name, platform, token_hash, status, created_by, created_at) VALUES (?,?,?,?, 'active', ?, ?)", id, name, "macos", await hashToken(token), actor.userId, nowIso());
  await audit(env, { actorUserId: actor.userId, action: "worker.registered", resourceType: "worker", resourceId: id, metadata: { name }, req });
  // The secret is shown exactly once; only its hash is stored.
  return { id, name, token };
}

export async function revokeWorker(env: AppEnv, actor: Actor, workerId: string, req?: Request) {
  if (!actor.isPlatformOwner) throw forbidden();
  const w = await one(env.DB, "SELECT id FROM worker_registry WHERE id = ?", workerId);
  if (!w) throw notFound("Worker");
  const now = nowIso();
  await batch(env.DB, [
    stmt(env.DB, "UPDATE worker_registry SET status = 'revoked', revoked_at = ?, current_job_id = NULL WHERE id = ?", now, workerId),
    // Release anything the revoked worker held so another worker can take over.
    stmt(env.DB, "UPDATE worker_jobs SET status = 'queued', worker_id = NULL, lease_token_hash = NULL, lease_expires_at = NULL, updated_at = ? WHERE worker_id = ? AND status IN ('claimed','running')", now, workerId),
  ]);
  await audit(env, { actorUserId: actor.userId, action: "worker.revoked", resourceType: "worker", resourceId: workerId, req });
  return { id: workerId, revoked: true };
}

export async function listWorkers(env: AppEnv, actor: Actor) {
  if (!actor.isPlatformOwner) throw forbidden();
  const rows = await all<Record<string, unknown>>(env.DB, "SELECT id, name, platform, status, worker_version, last_heartbeat_at, current_job_id, jobs_completed, jobs_failed, last_error, created_at, revoked_at FROM worker_registry ORDER BY created_at DESC");
  const cutoff = addSeconds(-WORKER_ONLINE_WINDOW_SECONDS);
  return rows.map((w) => ({ ...w, online: w.status === "active" && !!w.last_heartbeat_at && (w.last_heartbeat_at as string) > cutoff }));
}

export async function processingStats(env: AppEnv) {
  const q = await one<{ queued: number; running: number; failed: number; avg_ms: number | null }>(env.DB,
    `SELECT SUM(status = 'queued') AS queued, SUM(status IN ('claimed','running')) AS running, SUM(status = 'failed') AS failed,
            (SELECT AVG((julianday(completed_at) - julianday(started_at)) * 86400000) FROM worker_jobs WHERE status = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL) AS avg_ms
       FROM worker_jobs`);
  const online = await one<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM worker_registry WHERE status = 'active' AND last_heartbeat_at > ?", addSeconds(-WORKER_ONLINE_WINDOW_SECONDS));
  return { queued: q?.queued ?? 0, running: q?.running ?? 0, failed: q?.failed ?? 0, avgProcessingMs: q?.avg_ms ? Math.round(q.avg_ms) : null, workersOnline: online?.n ?? 0 };
}

export async function listJobs(env: AppEnv, actor: Actor, opts: { status?: string; limit?: number } = {}) {
  if (!actor.isPlatformOwner) throw forbidden();
  const where = opts.status ? "WHERE j.status = ?" : ""; const params = opts.status ? [opts.status] : [];
  return all(env.DB, `SELECT j.id, j.build_id, j.status, j.attempt_count, j.max_attempts, j.progress_percent, j.stage, j.progress_message, j.error_code, j.error_message, j.worker_id, j.created_at, j.completed_at, w.name AS worker_name, b.original_filename
    FROM worker_jobs j LEFT JOIN worker_registry w ON w.id = j.worker_id LEFT JOIN builds b ON b.id = j.build_id ${where} ORDER BY j.created_at DESC LIMIT ?`, ...params, Math.min(opts.limit ?? 50, 200));
}

export async function cancelJob(env: AppEnv, actor: Actor, jobId: string, req?: Request) {
  if (!actor.isPlatformOwner) throw forbidden();
  const j = await one<{ id: string; status: string; build_id: string }>(env.DB, "SELECT id, status, build_id FROM worker_jobs WHERE id = ?", jobId);
  if (!j) throw notFound("Job");
  if (j.status !== "queued") throw new ApiError("INVALID_STATE", "Only queued jobs can be cancelled safely; a running job must finish or its lease expire.");
  await run(env.DB, "UPDATE worker_jobs SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'queued'", nowIso(), jobId);
  await audit(env, { actorUserId: actor.userId, action: "job.cancelled", resourceType: "job", resourceId: jobId, req });
  return { id: jobId, cancelled: true };
}

// ---------------------------------------------------------------- worker protocol

export async function heartbeat(env: AppEnv, workerId: string, input: { workerVersion: string }) {
  await run(env.DB, "UPDATE worker_registry SET last_heartbeat_at = ?, worker_version = ? WHERE id = ?", nowIso(), input.workerVersion, workerId);
  return { ok: true, serverTime: nowIso() };
}

/** Return expired-lease jobs to the queue (or fail them when attempts are exhausted). Safe to call from claim and cron. */
export async function reclaimExpiredLeases(env: AppEnv): Promise<number> {
  const now = nowIso();
  const expired = await all<{ id: string; build_id: string; attempt_count: number; max_attempts: number; worker_id: string | null }>(env.DB,
    "SELECT id, build_id, attempt_count, max_attempts, worker_id FROM worker_jobs WHERE status IN ('claimed','running') AND lease_expires_at < ?", now);
  for (const j of expired) {
    const exhausted = j.attempt_count >= j.max_attempts;
    const res = await one(env.DB,
      `UPDATE worker_jobs SET status = ?, lease_token_hash = NULL, lease_expires_at = NULL, worker_id = NULL, error_code = 'LEASE_EXPIRED', error_message = 'Worker lease expired before completion.', updated_at = ?${exhausted ? ", completed_at = ?" : ""}
        WHERE id = ? AND status IN ('claimed','running') AND lease_expires_at < ? RETURNING id`,
      ...[exhausted ? "failed" : "queued", now, ...(exhausted ? [now] : []), j.id, now]);
    if (res && exhausted) await run(env.DB, "UPDATE builds SET validation_status = 'failed', eligibility_status = 'needs_review', processing_status = 'failed', updated_at = ? WHERE id = ?", now, j.build_id);
    if (res && j.worker_id) await run(env.DB, "UPDATE worker_registry SET current_job_id = NULL WHERE id = ? AND current_job_id = ?", j.worker_id, j.id);
  }
  return expired.length;
}

export interface ClaimedJob {
  jobId: string; buildId: string; attempt: number; leaseToken: string; leaseExpiresAt: string; downloadUrl: string;
  expected: { sha256: string; sizeBytes: number; bundleIdentifier: string | null };
}

export async function claimJob(env: AppEnv, workerId: string): Promise<ClaimedJob | null> {
  await reclaimExpiredLeases(env);
  const leaseToken = randomToken(24);
  const now = nowIso(); const leaseExpiresAt = addSeconds(LEASE_SECONDS);
  // Single-statement claim => atomic; two workers can never obtain the same row.
  const job = await one<{ id: string; build_id: string; attempt_count: number; input_json: string | null }>(env.DB,
    `UPDATE worker_jobs SET status = 'claimed', worker_id = ?, lease_token_hash = ?, lease_expires_at = ?, claimed_at = ?, attempt_count = attempt_count + 1, updated_at = ?
      WHERE id = (SELECT id FROM worker_jobs WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at LIMIT 1) AND status = 'queued'
      RETURNING id, build_id, attempt_count, input_json`, workerId, await hashToken(leaseToken), leaseExpiresAt, now, now, now);
  if (!job) return null;
  const build = await one<BuildRow>(env.DB, "SELECT * FROM builds WHERE id = ?", job.build_id);
  if (!build || build.deleted_at) {
    await run(env.DB, "UPDATE worker_jobs SET status = 'cancelled', updated_at = ? WHERE id = ?", now, job.id);
    return claimJob(env, workerId);
  }
  await batch(env.DB, [
    stmt(env.DB, "UPDATE worker_registry SET current_job_id = ?, last_heartbeat_at = ? WHERE id = ?", job.id, now, workerId),
    stmt(env.DB, "UPDATE builds SET validation_status = 'running', processing_status = 'integrity_check', updated_at = ? WHERE id = ?", now, build.id),
  ]);
  const input = parseJson<{ expectedBundleIdentifier?: string | null }>(job.input_json, {});
  await audit(env, { organisationId: build.organisation_id, actorType: "worker", action: "job.claimed", resourceType: "job", resourceId: job.id, metadata: { workerId, attempt: job.attempt_count } });
  return {
    jobId: job.id, buildId: build.id, attempt: job.attempt_count, leaseToken, leaseExpiresAt,
    // 45-minute window so large IPAs can download slowly; URL is bound to this build only.
    downloadUrl: await signedFileUrl(env, { k: "build", id: build.id }, 45 * 60),
    expected: { sha256: build.sha256, sizeBytes: build.file_size_bytes, bundleIdentifier: input.expectedBundleIdentifier ?? null },
  };
}

interface JobRow { id: string; build_id: string; worker_id: string | null; status: string; attempt_count: number; max_attempts: number; lease_token_hash: string | null; lease_expires_at: string | null; started_at: string | null }

/** Validates job ownership + lease. Stale or foreign updates are rejected with LEASE_LOST. */
async function ownedJob(env: AppEnv, workerId: string, jobId: string, leaseToken: string, allow: string[] = ["claimed", "running"]): Promise<JobRow> {
  const j = await one<JobRow>(env.DB, "SELECT id, build_id, worker_id, status, attempt_count, max_attempts, lease_token_hash, lease_expires_at, started_at FROM worker_jobs WHERE id = ?", jobId);
  if (!j || j.worker_id !== workerId || !j.lease_token_hash) throw new ApiError("LEASE_LOST", "This job is not leased to this worker.");
  if (!timingSafeEqual(j.lease_token_hash, await hashToken(leaseToken))) throw new ApiError("LEASE_LOST", "Lease token mismatch.");
  if (!allow.includes(j.status)) throw new ApiError("LEASE_LOST", `Job is ${j.status}.`);
  if (j.lease_expires_at && j.lease_expires_at < nowIso()) throw new ApiError("LEASE_LOST", "The lease has expired.");
  return j;
}

export async function markStarted(env: AppEnv, workerId: string, jobId: string, leaseToken: string) {
  const j = await ownedJob(env, workerId, jobId, leaseToken);
  await run(env.DB, "UPDATE worker_jobs SET status = 'running', started_at = COALESCE(started_at, ?), lease_expires_at = ?, updated_at = ? WHERE id = ?", nowIso(), addSeconds(LEASE_SECONDS), nowIso(), jobId);
  return { jobId: j.id, leaseExpiresAt: addSeconds(LEASE_SECONDS) };
}

const STAGE_TO_PROCESSING: Record<string, string> = {
  integrity_check: "integrity_check", structure_inspection: "structure_inspection", metadata_extraction: "metadata_extraction",
  signature_inspection: "signature_inspection", eligibility_assessment: "eligibility_assessment",
};

export async function reportProgress(env: AppEnv, workerId: string, jobId: string, p: { leaseToken: string; stage: string; percent: number; message?: string }) {
  const j = await ownedJob(env, workerId, jobId, p.leaseToken);
  const exp = addSeconds(LEASE_SECONDS);
  await run(env.DB, "UPDATE worker_jobs SET progress_percent = MAX(progress_percent, ?), stage = ?, progress_message = ?, lease_expires_at = ?, updated_at = ? WHERE id = ?", p.percent, p.stage, p.message ?? null, exp, nowIso(), jobId);
  if (STAGE_TO_PROCESSING[p.stage]) await run(env.DB, "UPDATE builds SET processing_status = ?, updated_at = ? WHERE id = ?", STAGE_TO_PROCESSING[p.stage], nowIso(), j.build_id);
  return { leaseExpiresAt: exp };
}

export async function renewLease(env: AppEnv, workerId: string, jobId: string, leaseToken: string) {
  await ownedJob(env, workerId, jobId, leaseToken);
  const exp = addSeconds(LEASE_SECONDS);
  await run(env.DB, "UPDATE worker_jobs SET lease_expires_at = ?, updated_at = ? WHERE id = ?", exp, nowIso(), jobId);
  return { leaseExpiresAt: exp };
}

export async function completeJob(env: AppEnv, workerId: string, jobId: string, input: { leaseToken: string; report: unknown }) {
  const existing = await one<{ status: string; worker_id: string | null; lease_token_hash: string | null }>(env.DB, "SELECT status, worker_id, lease_token_hash FROM worker_jobs WHERE id = ?", jobId);
  // Idempotent replay: same worker + same lease completing an already-completed job is a no-op success.
  if (existing?.status === "completed" && existing.worker_id === workerId && existing.lease_token_hash && timingSafeEqual(existing.lease_token_hash, await hashToken(input.leaseToken)))
    return { jobId, status: "completed", replay: true };
  const job = await ownedJob(env, workerId, jobId, input.leaseToken);
  const report: ValidationReport = parse(validationReportSchema, input.report);
  const build = (await one<BuildRow>(env.DB, "SELECT * FROM builds WHERE id = ?", job.build_id))!;
  const project = (await one<ProjectRow>(env.DB, "SELECT * FROM projects WHERE id = ?", build.project_id))!;

  if (report.file.sha256 !== build.sha256 || report.file.sizeBytes !== build.file_size_bytes)
    return failJob(env, workerId, jobId, { leaseToken: input.leaseToken, errorCode: "IPA_INTEGRITY_MISMATCH", message: "Worker-computed checksum/size does not match the uploaded record.", retryable: false });

  // Authoritative eligibility = the more conservative of the worker's verdict and the API's own derivation from the facts.
  const derived = assessEligibility(report, { expectedBundleId: project.expected_bundle_identifier });
  const eligibility: Eligibility = moreConservative(report.eligibilityStatus, derived.status);
  const now = nowIso();
  const reportId = newId();
  const reportKey = keys.report(build.organisation_id, build.project_id, build.id, reportId);
  const warnings = [...new Set([...report.warnings, ...derived.warnings, ...derived.reasons])];
  const stored = { ...report, eligibilityStatus: eligibility, apiAssessment: { status: derived.status, reasons: derived.reasons, warnings: derived.warnings } };
  await env.BUCKET.put(reportKey, JSON.stringify(stored), { httpMetadata: { contentType: "application/json" } });
  const sizeBytes = JSON.stringify(stored).length;
  const failedReport = report.overallStatus === "failed";
  try {
    await batch(env.DB, [
      stmt(env.DB, `INSERT INTO validation_reports (id, build_id, worker_job_id, attempt, worker_version, overall_status, eligibility_status, metadata_json, signing_summary_json, profile_summary_json, entitlements_summary_json, checks_json, warnings_json, errors_json, limitations_json, report_r2_key, started_at, completed_at, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        reportId, build.id, jobId, job.attempt_count, (await one<{ worker_version: string | null }>(env.DB, "SELECT worker_version FROM worker_registry WHERE id = ?", workerId))?.worker_version ?? null,
        report.overallStatus, eligibility, JSON.stringify({ file: report.file, app: report.app }), JSON.stringify(report.signing), JSON.stringify(report.provisioning), JSON.stringify(report.entitlements),
        JSON.stringify(report.checks), JSON.stringify(warnings), JSON.stringify(report.errors), JSON.stringify(report.limitations), reportKey, job.started_at, now, now),
      stmt(env.DB, "UPDATE worker_jobs SET status = 'completed', completed_at = ?, progress_percent = 100, stage = 'complete', result_json = ?, lease_expires_at = NULL, updated_at = ? WHERE id = ?", now, JSON.stringify({ reportId, eligibility }), now, jobId),
      stmt(env.DB, "INSERT INTO build_files (id, build_id, file_type, r2_object_key, mime_type, size_bytes, created_at) VALUES (?,?,?,?,?,?,?)", newId(), build.id, "validation_report", reportKey, "application/json", sizeBytes, now),
      stmt(env.DB,
        `UPDATE builds SET validation_status = ?, eligibility_status = ?, processing_status = ?, validated_at = ?,
           app_name = ?, bundle_identifier = ?, version = ?, build_number = ?, minimum_os_version = ?, supported_device_families_json = ?, architectures_json = ?, updated_at = ? WHERE id = ?`,
        failedReport ? "failed" : "completed", eligibility, failedReport ? "failed" : "complete", now,
        // Extracted values take precedence over what the uploader typed.
        report.app.name ?? null, report.app.bundleIdentifier ?? null, report.app.version ?? build.declared_version, report.app.buildNumber ?? build.declared_build_number,
        report.app.minimumOSVersion ?? null, JSON.stringify(report.app.deviceFamilies ?? []), JSON.stringify(report.app.architectures ?? []), now, build.id),
      stmt(env.DB, "UPDATE worker_registry SET jobs_completed = jobs_completed + 1, current_job_id = NULL WHERE id = ?", workerId),
    ]);
  } catch (e) {
    // UNIQUE(worker_job_id, attempt) prevents a duplicate report for the same attempt.
    if (String((e as Error).message).includes("UNIQUE")) return { jobId, status: "completed", replay: true };
    throw e;
  }
  await audit(env, { organisationId: build.organisation_id, actorType: "worker", action: "job.completed", resourceType: "job", resourceId: jobId, metadata: { eligibility, workerId } });
  await notify(env, { userIds: await projectStaffIds(env, build.project_id, build.organisation_id), organisationId: build.organisation_id, type: failedReport ? "validation_failed" : "validation_completed", title: `Validation ${failedReport ? "failed" : "completed"}: ${report.app.name ?? build.original_filename}`, body: `Eligibility: ${eligibility.replace(/_/g, " ")}`, resourceType: "build", resourceId: build.id, path: `/app/builds/${build.id}/validation` });
  return { jobId, status: "completed", eligibility };
}

export async function failJob(env: AppEnv, workerId: string, jobId: string, f: { leaseToken: string; errorCode: string; message: string; retryable: boolean }) {
  const job = await ownedJob(env, workerId, jobId, f.leaseToken);
  const now = nowIso();
  const willRetry = f.retryable && job.attempt_count < job.max_attempts;
  const backoff = Math.min(15 * 60, 30 * 2 ** (job.attempt_count - 1)); // 30s, 60s, 120s … capped at 15 min
  if (willRetry) {
    await batch(env.DB, [
      stmt(env.DB, "UPDATE worker_jobs SET status = 'queued', worker_id = NULL, lease_token_hash = NULL, lease_expires_at = NULL, next_attempt_at = ?, error_code = ?, error_message = ?, updated_at = ? WHERE id = ?", addSeconds(backoff), f.errorCode, f.message.slice(0, 1000), now, jobId),
      stmt(env.DB, "UPDATE builds SET validation_status = 'pending', processing_status = 'queued_for_validation', updated_at = ? WHERE id = ?", now, job.build_id),
      stmt(env.DB, "UPDATE worker_registry SET current_job_id = NULL, last_error = ? WHERE id = ?", f.message.slice(0, 300), workerId),
    ]);
    return { jobId, status: "queued", retryInSeconds: backoff };
  }
  // IPA_* codes describe a bad package (a definitive negative); anything else is an infrastructure failure we cannot judge.
  const eligibility: Eligibility = f.errorCode.startsWith("IPA_") ? "not_eligible" : "needs_review";
  await batch(env.DB, [
    stmt(env.DB, "UPDATE worker_jobs SET status = 'failed', completed_at = ?, error_code = ?, error_message = ?, retryable = ?, lease_expires_at = NULL, updated_at = ? WHERE id = ?", now, f.errorCode, f.message.slice(0, 1000), f.retryable ? 1 : 0, now, jobId),
    stmt(env.DB, "UPDATE builds SET validation_status = 'failed', eligibility_status = ?, processing_status = 'failed', updated_at = ? WHERE id = ?", eligibility, now, job.build_id),
    stmt(env.DB, "UPDATE worker_registry SET jobs_failed = jobs_failed + 1, current_job_id = NULL, last_error = ? WHERE id = ?", f.message.slice(0, 300), workerId),
  ]);
  const build = (await one<BuildRow>(env.DB, "SELECT * FROM builds WHERE id = ?", job.build_id))!;
  await audit(env, { organisationId: build.organisation_id, actorType: "worker", action: "job.failed", resourceType: "job", resourceId: jobId, metadata: { code: f.errorCode, workerId } });
  await notify(env, { userIds: await projectStaffIds(env, build.project_id, build.organisation_id), organisationId: build.organisation_id, type: "validation_failed", title: `Validation failed: ${build.original_filename}`, body: f.message.slice(0, 200), resourceType: "build", resourceId: build.id, path: `/app/builds/${build.id}/validation` });
  return { jobId, status: "failed" };
}
