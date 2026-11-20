import type { AppEnv } from "@/lib/env";
import type { Actor } from "@/lib/auth";
import { all, one, run, stmt, batch, likeTerm, parseJson, type Page } from "@/lib/db";
import { ApiError, notFound } from "@/lib/errors";
import { newId } from "@/lib/crypto";
import { addSeconds, nowIso } from "@/lib/time";
import { IPA_PART_SIZE } from "@/lib/rules";
import { audit } from "@/lib/audit";
import { loadBuild, loadProject } from "@/lib/access";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { keys, isZip, sha256OfObject } from "@/lib/storage";
import { notify, projectStaffIds, projectMemberIds } from "@/lib/notify";
import type { BuildRow } from "@/lib/types";

export function buildDto(b: BuildRow, internal: boolean) {
  const { r2_object_key: _k, internal_notes, supported_device_families_json, architectures_json, ...rest } = b;
  void _k;
  return {
    ...rest,
    supported_device_families: parseJson<number[]>(supported_device_families_json, []),
    architectures: parseJson<string[]>(architectures_json, []),
    ...(internal ? { internal_notes } : {}),
  };
}

// ---------------------------------------------------------------- uploads

export async function createUploadSession(
  env: AppEnv, actor: Actor, projectId: string,
  input: { filename: string; sizeBytes: number; sha256: string; idempotencyKey?: string }, req?: Request,
) {
  const { project } = await loadProject(env, actor, projectId, "build:upload");
  if (project.status !== "active") throw new ApiError("INVALID_STATE", "Uploads are disabled for paused or archived projects.");
  const settings = await getSettings(env);
  if (input.sizeBytes > settings.maxIpaBytes) throw new ApiError("PAYLOAD_TOO_LARGE", `IPA exceeds the configured limit of ${settings.maxIpaBytes} bytes.`, { maxBytes: settings.maxIpaBytes });
  if (input.idempotencyKey) {
    const existing = await one<{ id: string }>(env.DB, "SELECT id FROM upload_sessions WHERE user_id = ? AND idempotency_key = ?", actor.userId, input.idempotencyKey);
    if (existing) return sessionState(env, existing.id);
  }
  const id = newId(); const buildId = newId();
  const key = keys.ipa(project.organisation_id, project.id, buildId);
  const mp = await env.BUCKET.createMultipartUpload(key, { httpMetadata: { contentType: "application/octet-stream", contentDisposition: "attachment" } });
  const now = nowIso();
  await run(env.DB,
    `INSERT INTO upload_sessions (id, organisation_id, project_id, user_id, r2_object_key, multipart_upload_id, original_filename, expected_size_bytes, expected_sha256, part_size_bytes, idempotency_key, build_id, status, expires_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'open', ?, ?)`,
    id, project.organisation_id, project.id, actor.userId, key, mp.uploadId, input.filename, input.sizeBytes, input.sha256, IPA_PART_SIZE, input.idempotencyKey ?? null, buildId, addSeconds(24 * 3600), now);
  await audit(env, { organisationId: project.organisation_id, actorUserId: actor.userId, action: "upload.initiated", resourceType: "upload_session", resourceId: id, metadata: { sizeBytes: input.sizeBytes }, req });
  return sessionState(env, id);
}

interface SessionRow {
  id: string; organisation_id: string; project_id: string; user_id: string; r2_object_key: string; multipart_upload_id: string | null;
  original_filename: string; expected_size_bytes: number; expected_sha256: string; part_size_bytes: number; build_id: string;
  status: string; failure_reason: string | null; expires_at: string; completed_at: string | null;
}

async function loadSession(env: AppEnv, actor: Actor, sessionId: string): Promise<SessionRow> {
  const s = await one<SessionRow>(env.DB, "SELECT * FROM upload_sessions WHERE id = ?", sessionId);
  // Sessions belong to the uploader; anything else is indistinguishable from "does not exist".
  if (!s || s.user_id !== actor.userId) throw notFound("Upload session");
  await loadProject(env, actor, s.project_id, "build:upload"); // re-check access (member may have been removed)
  return s;
}

export async function getUploadSession(env: AppEnv, actor: Actor, sessionId: string) {
  await loadSession(env, actor, sessionId);
  return sessionState(env, sessionId);
}

export async function sessionState(env: AppEnv, sessionId: string) {
  const s = (await one<SessionRow>(env.DB, "SELECT * FROM upload_sessions WHERE id = ?", sessionId))!;
  const parts = await all<{ part_number: number; size_bytes: number }>(env.DB, "SELECT part_number, size_bytes FROM upload_parts WHERE upload_session_id = ? ORDER BY part_number", sessionId);
  return {
    id: s.id, status: s.status, filename: s.original_filename, sizeBytes: s.expected_size_bytes, partSizeBytes: s.part_size_bytes,
    totalParts: Math.max(1, Math.ceil(s.expected_size_bytes / s.part_size_bytes)), uploadedParts: parts.map((p) => p.part_number),
    expiresAt: s.expires_at, buildId: s.build_id, failureReason: s.failure_reason,
  };
}

export async function uploadPart(env: AppEnv, actor: Actor, sessionId: string, partNumber: number, body: ReadableStream | ArrayBuffer | null, contentLength: number) {
  const s = await loadSession(env, actor, sessionId);
  if (s.status !== "open") throw new ApiError("INVALID_STATE", "This upload session is not accepting parts.");
  if (s.expires_at < nowIso()) throw new ApiError("INVALID_STATE", "This upload session has expired.");
  const total = Math.max(1, Math.ceil(s.expected_size_bytes / s.part_size_bytes));
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > total) throw new ApiError("VALIDATION_ERROR", "Invalid part number.");
  const expected = partNumber < total ? s.part_size_bytes : s.expected_size_bytes - s.part_size_bytes * (total - 1);
  if (!body || contentLength !== expected) throw new ApiError("VALIDATION_ERROR", `Part ${partNumber} must be exactly ${expected} bytes.`, { expected, received: contentLength });
  const mp = env.BUCKET.resumeMultipartUpload(s.r2_object_key, s.multipart_upload_id!);
  // R2 needs a stream of known length; the framework's request body wrapper hides Content-Length, so re-wrap it.
  let payload: ReadableStream | ArrayBuffer = body;
  const FLS = (globalThis as { FixedLengthStream?: new (n: number) => { readable: ReadableStream; writable: WritableStream } }).FixedLengthStream;
  if (FLS && body instanceof ReadableStream) {
    const fl = new FLS(contentLength);
    void body.pipeTo(fl.writable).catch(() => undefined);
    payload = fl.readable;
  }
  const part = await mp.uploadPart(partNumber, payload);
  await run(env.DB, "INSERT INTO upload_parts (upload_session_id, part_number, etag, size_bytes, created_at) VALUES (?,?,?,?,?) ON CONFLICT(upload_session_id, part_number) DO UPDATE SET etag = excluded.etag, size_bytes = excluded.size_bytes",
    sessionId, partNumber, part.etag, expected, nowIso());
  return { partNumber, size: expected };
}

/** Idempotent: a repeated call on a completed session returns the same verified result and never re-completes the object. */
export async function completeUpload(env: AppEnv, actor: Actor, sessionId: string, req?: Request) {
  const s = await loadSession(env, actor, sessionId);
  if (s.status === "completed") return { ...(await sessionState(env, sessionId)), verified: true };
  if (s.status !== "open") throw new ApiError("INVALID_STATE", `Upload session is ${s.status}.`);
  const claimed = await one(env.DB, "UPDATE upload_sessions SET status = 'completing' WHERE id = ? AND status = 'open' RETURNING id", sessionId);
  if (!claimed) throw new ApiError("CONFLICT", "Upload completion is already in progress.");
  const fail = async (reason: string, code: "VALIDATION_ERROR" | "INVALID_STATE" = "VALIDATION_ERROR", cleanup = true): Promise<never> => {
    await run(env.DB, "UPDATE upload_sessions SET status = 'failed', failure_reason = ? WHERE id = ?", reason, sessionId);
    if (cleanup) {
      try { await env.BUCKET.resumeMultipartUpload(s.r2_object_key, s.multipart_upload_id!).abort(); } catch { /* may already be completed */ }
      try { await env.BUCKET.delete(s.r2_object_key); } catch { /* best effort */ }
    }
    await audit(env, { organisationId: s.organisation_id, actorUserId: actor.userId, action: "upload.failed", resourceType: "upload_session", resourceId: sessionId, metadata: { reason }, req });
    throw new ApiError(code, reason);
  };
  const total = Math.max(1, Math.ceil(s.expected_size_bytes / s.part_size_bytes));
  const parts = await all<{ part_number: number; etag: string; size_bytes: number }>(env.DB, "SELECT part_number, etag, size_bytes FROM upload_parts WHERE upload_session_id = ? ORDER BY part_number", sessionId);
  if (parts.length !== total || parts.some((p, i) => p.part_number !== i + 1)) {
    // Recoverable: let the client keep uploading missing parts.
    await run(env.DB, "UPDATE upload_sessions SET status = 'open' WHERE id = ?", sessionId);
    throw new ApiError("INVALID_STATE", "Not all parts have been uploaded.", { missing: Array.from({ length: total }, (_, i) => i + 1).filter((n) => !parts.some((p) => p.part_number === n)) });
  }
  const mp = env.BUCKET.resumeMultipartUpload(s.r2_object_key, s.multipart_upload_id!);
  try {
    await mp.complete(parts.map((p) => ({ partNumber: p.part_number, etag: p.etag })));
  } catch {
    return fail("Storage could not assemble the uploaded parts.", "INVALID_STATE");
  }
  const head = await env.BUCKET.head(s.r2_object_key);
  if (!head || head.size !== s.expected_size_bytes) return fail("Uploaded size does not match the declared size.");
  const magic = await env.BUCKET.get(s.r2_object_key, { range: { offset: 0, length: 4 } });
  if (!magic || !isZip(new Uint8Array(await magic.arrayBuffer()))) return fail("The file is not a ZIP/IPA archive.");
  const actual = await sha256OfObject(env, s.r2_object_key);
  if (actual === null) return fail("Uploaded object is missing.");
  if (actual !== s.expected_sha256) return fail("SHA-256 checksum does not match the declared checksum.");
  await run(env.DB, "UPDATE upload_sessions SET status = 'completed', completed_at = ? WHERE id = ?", nowIso(), sessionId);
  await audit(env, { organisationId: s.organisation_id, actorUserId: actor.userId, action: "upload.completed", resourceType: "upload_session", resourceId: sessionId, metadata: { sizeBytes: s.expected_size_bytes }, req });
  return { ...(await sessionState(env, sessionId)), verified: true, checksum: "verified" as const };
}

export async function abortUpload(env: AppEnv, actor: Actor, sessionId: string, req?: Request) {
  const s = await loadSession(env, actor, sessionId);
  if (s.status === "completed") throw new ApiError("INVALID_STATE", "A completed upload cannot be cancelled; delete the build instead.");
  if (s.status === "open" || s.status === "completing") {
    try { await env.BUCKET.resumeMultipartUpload(s.r2_object_key, s.multipart_upload_id!).abort(); } catch { /* ignore */ }
    await run(env.DB, "UPDATE upload_sessions SET status = 'aborted' WHERE id = ?", sessionId);
    await audit(env, { organisationId: s.organisation_id, actorUserId: actor.userId, action: "upload.aborted", resourceType: "upload_session", resourceId: sessionId, req });
  }
  return { id: sessionId, aborted: true };
}

// ---------------------------------------------------------------- builds

/** Create the build record + validation job from a completed upload session. Idempotent per session. */
export async function createBuild(
  env: AppEnv, actor: Actor, projectId: string,
  input: { uploadSessionId: string; releaseTitle?: string | null; releaseNotes?: string | null; internalNotes?: string | null; declaredVersion?: string | null; declaredBuildNumber?: string | null; distributionMethod: string; externalInstallUrl?: string | null; allowDownloadWhenIneligible: boolean },
  req?: Request,
) {
  const { project } = await loadProject(env, actor, projectId, "build:upload");
  const s = await loadSession(env, actor, input.uploadSessionId);
  if (s.project_id !== project.id) throw notFound("Upload session");
  if (s.status !== "completed") throw new ApiError("INVALID_STATE", "The upload has not been completed and verified.");
  const existing = await one<BuildRow>(env.DB, "SELECT * FROM builds WHERE id = ?", s.build_id);
  if (existing) return buildDto(existing, true); // idempotent replay
  if ((input.distributionMethod === "testflight" || input.distributionMethod === "app_store") && !input.externalInstallUrl)
    throw new ApiError("VALIDATION_ERROR", "An official Apple install/invitation URL is required for TestFlight and App Store distribution.");
  const now = nowIso(); const jobId = newId();
  await batch(env.DB, [
    stmt(env.DB,
      `INSERT INTO builds (id, organisation_id, project_id, uploaded_by, original_filename, r2_object_key, file_size_bytes, sha256, release_title, release_notes, internal_notes,
         declared_version, declared_build_number, distribution_method, external_install_url, allow_download_when_ineligible, validation_status, eligibility_status, processing_status, uploaded_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending','needs_review','queued_for_validation', ?,?,?)`,
      s.build_id, s.organisation_id, s.project_id, actor.userId, s.original_filename, s.r2_object_key, s.expected_size_bytes, s.expected_sha256,
      input.releaseTitle ?? null, input.releaseNotes ?? null, input.internalNotes ?? null, input.declaredVersion ?? null, input.declaredBuildNumber ?? null,
      input.distributionMethod, input.externalInstallUrl ?? null, input.allowDownloadWhenIneligible ? 1 : 0, now, now, now),
    stmt(env.DB, "INSERT INTO build_files (id, build_id, file_type, r2_object_key, mime_type, size_bytes, sha256, created_at) VALUES (?,?,?,?,?,?,?,?)",
      newId(), s.build_id, "ipa", s.r2_object_key, "application/octet-stream", s.expected_size_bytes, s.expected_sha256, now),
    stmt(env.DB, "INSERT INTO worker_jobs (id, build_id, job_type, status, max_attempts, input_json, idempotency_key, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      jobId, s.build_id, "validate_ipa", "queued", 3,
      JSON.stringify({ expectedSha256: s.expected_sha256, expectedSizeBytes: s.expected_size_bytes, expectedBundleIdentifier: project.expected_bundle_identifier }),
      `validate:${s.build_id}:initial`, now, now),
  ]);
  await audit(env, { organisationId: s.organisation_id, actorUserId: actor.userId, action: "build.created", resourceType: "build", resourceId: s.build_id, metadata: { jobId }, req });
  await notify(env, { userIds: (await projectStaffIds(env, project.id, project.organisation_id)).filter((u) => u !== actor.userId), organisationId: project.organisation_id, type: "build_uploaded", title: `New build uploaded to ${project.name}`, resourceType: "build", resourceId: s.build_id, path: `/app/builds/${s.build_id}` });
  return buildDto((await one<BuildRow>(env.DB, "SELECT * FROM builds WHERE id = ?", s.build_id))!, true);
}

const BUILD_SORTS: Record<string, string> = { created: "b.created_at DESC", version: "b.version DESC, b.build_number DESC", status: "b.validation_status ASC, b.created_at DESC" };

export async function listBuilds(env: AppEnv, actor: Actor, projectId: string, q: { page: number; pageSize: number; q?: string; validation?: string; eligibility?: string; publish?: string; uploader?: string; from?: string; to?: string; sort?: string }): Promise<Page<unknown>> {
  const { role } = await loadProject(env, actor, projectId, "build:view");
  const internal = can(role, "build:view_internal");
  const where = ["b.project_id = ?", "b.deleted_at IS NULL"]; const params: unknown[] = [projectId];
  if (!internal) where.push("b.publish_status = 'published'");
  if (q.q) { const t = likeTerm(q.q); where.push("(b.version LIKE ? ESCAPE '\\' OR b.bundle_identifier LIKE ? ESCAPE '\\' OR b.app_name LIKE ? ESCAPE '\\' OR b.release_title LIKE ? ESCAPE '\\' OR b.build_number LIKE ? ESCAPE '\\')"); params.push(t, t, t, t, t); }
  if (q.validation) { where.push("b.validation_status = ?"); params.push(q.validation); }
  if (q.eligibility) { where.push("b.eligibility_status = ?"); params.push(q.eligibility); }
  if (q.publish) { where.push("b.publish_status = ?"); params.push(q.publish); }
  if (q.uploader) { where.push("b.uploaded_by = ?"); params.push(q.uploader); }
  if (q.from) { where.push("b.created_at >= ?"); params.push(q.from); }
  if (q.to) { where.push("b.created_at <= ?"); params.push(q.to); }
  const W = where.join(" AND ");
  const total = (await one<{ n: number }>(env.DB, `SELECT COUNT(*) AS n FROM builds b WHERE ${W}`, ...params))?.n ?? 0;
  const rows = await all<BuildRow & { uploader_name: string | null }>(env.DB,
    `SELECT b.*, u.display_name AS uploader_name FROM builds b LEFT JOIN users u ON u.id = b.uploaded_by WHERE ${W}
      ORDER BY ${BUILD_SORTS[q.sort ?? "created"] ?? BUILD_SORTS.created} LIMIT ? OFFSET ?`, ...params, q.pageSize, (q.page - 1) * q.pageSize);
  return { items: rows.map((r) => ({ ...buildDto(r, internal), uploader_name: r.uploader_name })), page: q.page, pageSize: q.pageSize, total };
}

export async function getBuild(env: AppEnv, actor: Actor, buildId: string) {
  const { build, role, project } = await loadBuild(env, actor, buildId);
  const internal = can(role, "build:view_internal");
  const uploader = build.uploaded_by ? await one<{ display_name: string }>(env.DB, "SELECT display_name FROM users WHERE id = ?", build.uploaded_by) : null;
  const latestJob = await one(env.DB, "SELECT id, status, attempt_count, max_attempts, progress_percent, progress_message, stage, error_code, error_message, created_at, completed_at FROM worker_jobs WHERE build_id = ? ORDER BY created_at DESC LIMIT 1", buildId);
  const report = internal ? await latestReport(env, buildId) : null;
  return {
    ...buildDto(build, internal), uploader_name: uploader?.display_name ?? null, project: { id: project.id, name: project.name, organisation_id: project.organisation_id },
    permissions: { canPublish: can(role, "build:publish"), canDownloadIpa: can(role, "build:download_ipa"), canManageLinks: can(role, "distribution:manage"), canDelete: can(role, "build:delete"), canEdit: can(role, "build:update"), canRevalidate: can(role, "build:revalidate") },
    latestJob, validation: report,
  };
}

export async function latestReport(env: AppEnv, buildId: string) {
  const r = await one<Record<string, unknown>>(env.DB, "SELECT * FROM validation_reports WHERE build_id = ? ORDER BY created_at DESC LIMIT 1", buildId);
  return r ? reportDto(r) : null;
}

export function reportDto(r: Record<string, unknown>) {
  const j = (k: string, fb: unknown) => parseJson(r[k], fb);
  return {
    id: r.id, worker_job_id: r.worker_job_id, attempt: r.attempt, worker_version: r.worker_version, overall_status: r.overall_status, eligibility_status: r.eligibility_status,
    metadata: j("metadata_json", {}), signing: j("signing_summary_json", {}), profile: j("profile_summary_json", {}), entitlements: j("entitlements_summary_json", {}),
    checks: j("checks_json", []), warnings: j("warnings_json", []), errors: j("errors_json", []), limitations: j("limitations_json", []),
    started_at: r.started_at, completed_at: r.completed_at, created_at: r.created_at,
  };
}

export async function validationHistory(env: AppEnv, actor: Actor, buildId: string) {
  await loadBuild(env, actor, buildId, "build:view_internal");
  const jobs = await all(env.DB, "SELECT id, status, attempt_count, max_attempts, progress_percent, stage, error_code, error_message, created_at, started_at, completed_at FROM worker_jobs WHERE build_id = ? ORDER BY created_at DESC", buildId);
  const reports = (await all<Record<string, unknown>>(env.DB, "SELECT * FROM validation_reports WHERE build_id = ? ORDER BY created_at DESC", buildId)).map(reportDto);
  return { jobs, reports };
}

export async function getValidation(env: AppEnv, actor: Actor, buildId: string) {
  const { build } = await loadBuild(env, actor, buildId, "build:view_internal");
  return { validation_status: build.validation_status, eligibility_status: build.eligibility_status, processing_status: build.processing_status, report: await latestReport(env, buildId) };
}

export async function updateBuild(env: AppEnv, actor: Actor, buildId: string, patch: Record<string, unknown>, req?: Request) {
  const { build } = await loadBuild(env, actor, buildId, "build:update");
  const cols = ["release_title", "release_notes", "internal_notes", "distribution_method", "external_install_url"];
  const sets: string[] = []; const vals: unknown[] = [];
  for (const k of cols) if (k in patch && patch[k] !== undefined) { sets.push(`${k} = ?`); vals.push(patch[k]); }
  if ("allow_download_when_ineligible" in patch && patch.allow_download_when_ineligible !== undefined) { sets.push("allow_download_when_ineligible = ?"); vals.push(patch.allow_download_when_ineligible ? 1 : 0); }
  if (sets.length) await run(env.DB, `UPDATE builds SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`, ...vals, nowIso(), buildId);
  await audit(env, { organisationId: build.organisation_id, actorUserId: actor.userId, action: "build.updated", resourceType: "build", resourceId: buildId, metadata: { fields: Object.keys(patch) }, req });
  return getBuild(env, actor, buildId);
}

export async function publishBuild(env: AppEnv, actor: Actor, buildId: string, req?: Request) {
  const { build, project } = await loadBuild(env, actor, buildId, "build:publish");
  if (build.publish_status === "archived") throw new ApiError("INVALID_STATE", "Archived builds cannot be published.");
  if (project.status !== "active") throw new ApiError("INVALID_STATE", "The project is not active.");
  const external = build.distribution_method === "testflight" || build.distribution_method === "app_store";
  if (external) {
    if (!build.external_install_url) throw new ApiError("INVALID_STATE", "Configure the official Apple install URL before publishing.");
  } else {
    if (build.validation_status !== "completed") throw new ApiError("INVALID_STATE", "A build can only be published after validation has completed.");
    if (build.eligibility_status === "not_eligible" && !build.allow_download_when_ineligible)
      throw new ApiError("INVALID_STATE", "This build is not eligible for installation. Enable download-only access explicitly to publish it anyway.");
  }
  await run(env.DB, "UPDATE builds SET publish_status = 'published', published_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), buildId);
  await audit(env, { organisationId: build.organisation_id, actorUserId: actor.userId, action: "build.published", resourceType: "build", resourceId: buildId, req });
  await notify(env, { userIds: (await projectMemberIds(env, project.id)).filter((u) => u !== actor.userId), organisationId: project.organisation_id, type: "build_published", title: `${project.name} ${build.version ?? ""} is available`.trim(), resourceType: "build", resourceId: buildId, path: `/portal/builds` });
  return getBuild(env, actor, buildId);
}

export async function unpublishBuild(env: AppEnv, actor: Actor, buildId: string, req?: Request) {
  const { build } = await loadBuild(env, actor, buildId, "build:publish");
  await run(env.DB, "UPDATE builds SET publish_status = 'unpublished', updated_at = ? WHERE id = ? AND publish_status = 'published'", nowIso(), buildId);
  await audit(env, { organisationId: build.organisation_id, actorUserId: actor.userId, action: "build.unpublished", resourceType: "build", resourceId: buildId, req });
  return getBuild(env, actor, buildId);
}

export async function archiveBuild(env: AppEnv, actor: Actor, buildId: string, req?: Request) {
  const { build } = await loadBuild(env, actor, buildId, "build:archive");
  const now = nowIso();
  await batch(env.DB, [
    stmt(env.DB, "UPDATE builds SET publish_status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?", now, now, buildId),
    stmt(env.DB, "UPDATE distribution_links SET status = 'revoked', revoked_at = ? WHERE build_id = ? AND status != 'revoked'", now, buildId),
  ]);
  await audit(env, { organisationId: build.organisation_id, actorUserId: actor.userId, action: "build.archived", resourceType: "build", resourceId: buildId, req });
  return getBuild(env, actor, buildId);
}

/** Soft delete: build disappears and links are revoked immediately; objects are purged by the retention cron. */
export async function deleteBuild(env: AppEnv, actor: Actor, buildId: string, req?: Request) {
  const { build } = await loadBuild(env, actor, buildId, "build:delete");
  const now = nowIso();
  await batch(env.DB, [
    stmt(env.DB, "UPDATE builds SET deleted_at = ?, publish_status = 'unpublished', updated_at = ? WHERE id = ?", now, now, buildId),
    stmt(env.DB, "UPDATE distribution_links SET status = 'revoked', revoked_at = ? WHERE build_id = ? AND status != 'revoked'", now, buildId),
    stmt(env.DB, "UPDATE worker_jobs SET status = 'cancelled', updated_at = ? WHERE build_id = ? AND status IN ('queued','claimed','running')", now, buildId),
  ]);
  await audit(env, { organisationId: build.organisation_id, actorUserId: actor.userId, action: "build.deleted", resourceType: "build", resourceId: buildId, req });
  return { id: buildId, deleted: true };
}

export async function revalidateBuild(env: AppEnv, actor: Actor, buildId: string, req?: Request) {
  const { build, project } = await loadBuild(env, actor, buildId, "build:revalidate");
  const active = await one(env.DB, "SELECT id FROM worker_jobs WHERE build_id = ? AND status IN ('queued','claimed','running')", buildId);
  if (active) throw new ApiError("CONFLICT", "A validation job is already queued or running for this build.");
  const jobId = newId(); const now = nowIso();
  await batch(env.DB, [
    stmt(env.DB, "INSERT INTO worker_jobs (id, build_id, job_type, status, max_attempts, input_json, idempotency_key, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      jobId, buildId, "validate_ipa", "queued", 3, JSON.stringify({ expectedSha256: build.sha256, expectedSizeBytes: build.file_size_bytes, expectedBundleIdentifier: project.expected_bundle_identifier }), `validate:${buildId}:${jobId}`, now, now),
    stmt(env.DB, "UPDATE builds SET validation_status = 'pending', processing_status = 'queued_for_validation', updated_at = ? WHERE id = ?", now, buildId),
  ]);
  await audit(env, { organisationId: build.organisation_id, actorUserId: actor.userId, action: "build.revalidation_requested", resourceType: "build", resourceId: buildId, metadata: { jobId }, req });
  return { jobId };
}
