import type { AppEnv } from "@/lib/env";
import type { Actor } from "@/lib/auth";
import { all, one, run, stmt, batch } from "@/lib/db";
import { ApiError, notFound } from "@/lib/errors";
import { newId } from "@/lib/crypto";
import { addSeconds, nowIso } from "@/lib/time";
import { audit } from "@/lib/audit";
import { loadBuild, loadProject } from "@/lib/access";
import { signedFileUrl } from "@/lib/storage";
import { derivePublicToken } from "@/services/distribution";
import { hashToken } from "@/lib/crypto";
import { createApp, updateApp, setAppDisabled, deleteApp, appetizeConfigured, embedUrl, hostedUrl, AppetizeError, IOS_DEVICES } from "@/lib/appetize";
import { getSettings } from "@/lib/settings";
import { detectArchiveKind, inspectSimulatorTarGz, inspectSimulatorZip, SimulatorInspectError, type SimulatorInspection } from "@/lib/simulator-inspect";
import type { ByteSource } from "@/lib/ipa-inspect";
import type { BuildRow, ProjectRow, SimulatorPreviewRow } from "@/lib/types";

export const MAX_ATTEMPTS = 5;
const STALE_AFTER_SECONDS = 15 * 60;

const bucketSource = (env: AppEnv, key: string, size: number): ByteSource => ({
  size: async () => size,
  read: async (offset, length) => {
    const o = await env.BUCKET.get(key, { range: { offset, length } });
    if (!o) throw new ApiError("NOT_FOUND", "The uploaded archive could not be read from storage.");
    return new Uint8Array(await o.arrayBuffer());
  },
});

type UploadSessionRow = { build_id: string; organisation_id: string; project_id: string; r2_object_key: string; original_filename: string; expected_size_bytes: number; expected_sha256: string };
export interface SimulatorInput { releaseTitle?: string | null; releaseNotes?: string | null; internalNotes?: string | null; declaredVersion?: string | null; declaredBuildNumber?: string | null; preview?: { device?: string; expiresInDays?: number | null; updateExisting?: boolean } }

// ---------------------------------------------------------------- creation
/** Called by createBuild for the "Interactive Simulator Preview" option: validates the archive, records the build, queues the Appetize upload. */
export async function createSimulatorBuild(env: AppEnv, actor: Actor, project: ProjectRow, s: UploadSessionRow, input: SimulatorInput, req?: Request): Promise<BuildRow> {
  const head = await env.BUCKET.get(s.r2_object_key, { range: { offset: 0, length: 4 } });
  const kind = head ? detectArchiveKind(new Uint8Array(await head.arrayBuffer())) : null;
  if (!kind) throw new ApiError("VALIDATION_ERROR", "The file is not a ZIP or TAR.GZ archive. Upload the iOS Simulator .app folder compressed as .zip or .tar.gz.");

  let inspection: SimulatorInspection;
  try {
    inspection = kind === "zip"
      ? await inspectSimulatorZip(bucketSource(env, s.r2_object_key, s.expected_size_bytes))
      : await inspectSimulatorTarGz(async () => { const o = await env.BUCKET.get(s.r2_object_key); if (!o) throw new SimulatorInspectError("SIM_NOT_ARCHIVE", "The uploaded archive could not be read."); return o.body as ReadableStream<Uint8Array>; });
  } catch (e) {
    if (e instanceof SimulatorInspectError) throw new ApiError("VALIDATION_ERROR", e.message, { code: e.code });
    throw e;
  }

  const dup = await one<{ id: string; version: string | null }>(env.DB, "SELECT id, version FROM builds WHERE project_id = ? AND sha256 = ? AND build_kind = 'simulator' AND deleted_at IS NULL LIMIT 1", project.id, s.expected_sha256);
  if (dup) throw new ApiError("CONFLICT", `This exact simulator build was already uploaded${dup.version ? ` (version ${dup.version})` : ""}. Open that build instead of uploading it again.`, { buildId: dup.id });

  const bundleId = inspection.app.bundleIdentifier ?? project.expected_bundle_identifier;
  if (inspection.app.bundleIdentifier && project.expected_bundle_identifier && inspection.app.bundleIdentifier !== project.expected_bundle_identifier)
    inspection.warnings.push(`Bundle identifier ${inspection.app.bundleIdentifier} differs from the project's expected identifier ${project.expected_bundle_identifier}.`);

  // Reuse an existing Appetize app (same public key) when asked and one exists for this bundle id.
  let mode: "create" | "update" = "create"; let existingKey: string | null = null;
  if (input.preview?.updateExisting && bundleId) {
    const prev = await one<{ appetize_public_key: string }>(env.DB,
      `SELECT sp.appetize_public_key FROM simulator_previews sp JOIN builds b ON b.id = sp.build_id
        WHERE sp.project_id = ? AND sp.status = 'ready' AND sp.appetize_public_key IS NOT NULL AND b.bundle_identifier = ? ORDER BY sp.ready_at DESC LIMIT 1`, project.id, bundleId);
    if (prev) { mode = "update"; existingKey = prev.appetize_public_key; }
  }
  const device = IOS_DEVICES.includes((input.preview?.device ?? "iphone15pro") as never) ? (input.preview?.device ?? "iphone15pro") : "iphone15pro";
  const days = input.preview?.expiresInDays ?? null;
  const now = nowIso(); const id = newId();
  const detail = inspection.warnings.length ? `Queued. Notes: ${inspection.warnings.join(" ")}` : "Queued for upload to Appetize.";
  await batch(env.DB, [
    stmt(env.DB,
      `INSERT INTO builds (id, organisation_id, project_id, uploaded_by, original_filename, r2_object_key, file_size_bytes, sha256, release_title, release_notes, internal_notes,
         declared_version, declared_build_number, distribution_method, allow_download_when_ineligible, validation_status, eligibility_status, processing_status, uploaded_at, created_at, updated_at,
         app_name, bundle_identifier, version, build_number, minimum_os_version, architectures_json, validated_at, build_kind)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'download_only', 0, 'completed','eligible','complete', ?,?,?, ?,?,?,?,?,?,?, 'simulator')`,
      s.build_id, s.organisation_id, s.project_id, actor.userId, s.original_filename, s.r2_object_key, s.expected_size_bytes, s.expected_sha256,
      input.releaseTitle ?? null, input.releaseNotes ?? null, input.internalNotes ?? null, input.declaredVersion ?? null, input.declaredBuildNumber ?? null,
      now, now, now, project.app_display_name ?? inspection.app.name ?? project.name, inspection.app.bundleIdentifier, inspection.app.version ?? input.declaredVersion ?? "1.0",
      inspection.app.buildNumber ?? input.declaredBuildNumber ?? "1", inspection.app.minimumOSVersion, JSON.stringify(inspection.architectures), now),
    stmt(env.DB, "INSERT INTO build_files (id, build_id, file_type, r2_object_key, mime_type, size_bytes, sha256, created_at) VALUES (?,?,?,?,?,?,?,?)",
      newId(), s.build_id, "ipa", s.r2_object_key, "application/octet-stream", s.expected_size_bytes, s.expected_sha256, now),
    stmt(env.DB,
      `INSERT INTO simulator_previews (id, organisation_id, project_id, build_id, status, status_detail, file_type, mode, appetize_public_key, device, expires_at, uploaded_at, created_by, created_at, updated_at)
       VALUES (?,?,?,?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, s.organisation_id, s.project_id, s.build_id, detail, inspection.fileType, mode, existingKey, device, days ? addSeconds(days * 86400) : null, now, actor.userId, now, now),
  ]);
  await audit(env, { organisationId: s.organisation_id, actorUserId: actor.userId, action: "simulator_preview.created", resourceType: "build", resourceId: s.build_id, metadata: { mode, fileType: inspection.fileType }, req });
  await enqueuePreview(env, id);
  return (await one<BuildRow>(env.DB, "SELECT * FROM builds WHERE id = ?", s.build_id))!;
}

export async function enqueuePreview(env: AppEnv, previewId: string): Promise<boolean> {
  if (!env.NOTIFY_QUEUE) return false; // the 5-minute cron picks it up
  try { await env.NOTIFY_QUEUE.send({ type: "appetize", previewId }); return true; } catch { return false; }
}

// ---------------------------------------------------------------- Appetize upload (background)
const backoffSeconds = (attempt: number) => Math.min(30 * 60, 60 * 2 ** (attempt - 1));

/** Does another live preview use this Appetize key? (Shared keys are never disabled or deleted underneath it.) */
const keyShared = async (env: AppEnv, key: string, exceptId: string) =>
  !!(await one(env.DB, "SELECT id FROM simulator_previews WHERE appetize_public_key = ? AND id != ? AND status != 'deleted' AND enabled = 1 LIMIT 1", key, exceptId));

/** Sends the stored build to Appetize. Safe to call repeatedly: only a due `pending` preview is claimed, so duplicates never double-upload. */
export async function runPreviewUpload(env: AppEnv, previewId: string): Promise<{ status: string }> {
  const now = nowIso();
  const p = await one<SimulatorPreviewRow>(env.DB,
    "UPDATE simulator_previews SET status = 'uploading', status_detail = 'Preparing the upload to Appetize…', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) RETURNING *", now, previewId, now);
  if (!p) return { status: "skipped" };
  const fail = async (code: string, message: string, retryable: boolean) => {
    const retry = retryable && p.attempts < MAX_ATTEMPTS;
    await run(env.DB, "UPDATE simulator_previews SET status = ?, error_code = ?, status_detail = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?",
      retry ? "pending" : "failed", code, retry ? `${message} Retrying automatically (attempt ${p.attempts} of ${MAX_ATTEMPTS}).` : message, retry ? addSeconds(backoffSeconds(p.attempts)) : null, nowIso(), p.id);
    console.error(`simulator preview ${p.id} failed: ${code} (retry=${retry})`); // never includes tokens
    return { status: retry ? "pending" : "failed" };
  };
  try {
    if (!appetizeConfigured(env)) return await fail("NOT_CONFIGURED", "Appetize is not configured: the APPETIZE_API_TOKEN secret has not been set. Set it, then press Retry.", false);
    if (!env.APP_URL.startsWith("https://")) return await fail("NEEDS_HTTPS", "Appetize downloads the build from a public https address, but this portal's APP_URL is not https. Use the deployed portal.", false);
    const build = await one<BuildRow>(env.DB, "SELECT * FROM builds WHERE id = ? AND deleted_at IS NULL", p.build_id);
    if (!build) return await fail("BUILD_GONE", "The build no longer exists.", false);
    const url = await signedFileUrl(env, { k: "build", id: build.id }, 2 * 3600);
    const input = { url, fileType: p.file_type, note: `${build.app_name ?? "App"} ${build.version ?? ""} (${build.build_number ?? ""})`.trim(), embedHostname: new URL(env.APP_URL).hostname };
    // Hand-off: from here Appetize downloads and processes the archive (the call returns when it has).
    await run(env.DB, "UPDATE simulator_previews SET status = 'processing', status_detail = 'Appetize is downloading and processing the build…', updated_at = ? WHERE id = ?", nowIso(), p.id);
    const app = p.mode === "update" && p.appetize_public_key ? await updateApp(env, p.appetize_public_key, input) : await createApp(env, input);
    await run(env.DB, "UPDATE simulator_previews SET status = 'ready', status_detail = NULL, error_code = NULL, appetize_public_key = ?, appetize_version_code = ?, appetize_disabled = 0, next_attempt_at = NULL, ready_at = ?, updated_at = ? WHERE id = ?",
      app.publicKey, app.versionCode, nowIso(), nowIso(), p.id);
    await ensurePreviewMemberLink(env, p.id).catch(() => undefined);
    await audit(env, { organisationId: p.organisation_id, action: "simulator_preview.ready", resourceType: "build", resourceId: p.build_id, metadata: { mode: p.mode } });
    return { status: "ready" };
  } catch (e) {
    if (e instanceof AppetizeError) return fail(e.code, e.message, e.retryable);
    return fail("INTERNAL", "Unexpected error while uploading to Appetize.", true);
  }
}

/**
 * Every Ready preview is shown to the project's members (QA testers) in their app under "Available builds":
 * a standard "project members" preview link, created by the system for the uploader. Staff can revoke it on the Preview tab.
 */
export async function ensurePreviewMemberLink(env: AppEnv, previewId: string): Promise<void> {
  const p = await one<SimulatorPreviewRow>(env.DB, "SELECT * FROM simulator_previews WHERE id = ?", previewId);
  const build = p ? await one<BuildRow>(env.DB, "SELECT * FROM builds WHERE id = ? AND deleted_at IS NULL", p.build_id) : null;
  if (!p || !build || p.status !== "ready") return;
  const has = await one(env.DB, "SELECT id FROM distribution_links WHERE build_id = ? AND kind = 'preview' AND access_scope = 'project_members' AND status = 'active' LIMIT 1", build.id);
  if (has) return;
  const createdBy = build.uploaded_by ?? p.created_by;
  if (!createdBy) return;
  const id = newId(); const token = await derivePublicToken(env, id);
  await run(env.DB,
    `INSERT INTO distribution_links (id, organisation_id, project_id, build_id, created_by, token_hash, title, access_scope, expires_at, allow_download, allow_feedback, status, kind, created_at)
     VALUES (?,?,?,?,?,?,?, 'project_members', ?, 0, 1, 'active', 'preview', ?)`,
    id, p.organisation_id, p.project_id, build.id, createdBy, await hashToken(token), `Preview ${build.version ?? ""} (${build.build_number ?? "?"})`.trim(), p.expires_at, nowIso());
}

/** Cron: start due uploads and recover ones that were interrupted. */
export async function runDuePreviews(env: AppEnv): Promise<number> {
  const now = nowIso();
  await run(env.DB, "UPDATE simulator_previews SET status = 'pending', status_detail = 'The previous attempt was interrupted. Retrying…', next_attempt_at = NULL WHERE status IN ('uploading','processing') AND updated_at < ?", addSeconds(-STALE_AFTER_SECONDS));
  const due = await all<{ id: string }>(env.DB, "SELECT id FROM simulator_previews WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at LIMIT 3", now);
  for (const d of due) await runPreviewUpload(env, d.id);
  // Expired previews: stop Appetize streaming too (the portal already refuses them).
  const expired = await all<SimulatorPreviewRow>(env.DB, "SELECT * FROM simulator_previews WHERE status = 'ready' AND expires_at IS NOT NULL AND expires_at < ? AND appetize_disabled = 0 AND appetize_public_key IS NOT NULL LIMIT 5", now);
  for (const x of expired) {
    try { if (!(await keyShared(env, x.appetize_public_key!, x.id))) await setAppDisabled(env, x.appetize_public_key!, true); await run(env.DB, "UPDATE simulator_previews SET appetize_disabled = 1 WHERE id = ?", x.id); } catch { /* retried next run */ }
  }
  return due.length;
}

// ---------------------------------------------------------------- reading
export type PreviewState = "pending" | "uploading" | "processing" | "ready" | "failed" | "expired" | "disabled" | "deleted";
export function previewState(p: Pick<SimulatorPreviewRow, "status" | "enabled" | "expires_at">): PreviewState {
  if (p.status === "ready") { if (p.expires_at && p.expires_at < nowIso()) return "expired"; if (!p.enabled) return "disabled"; }
  return p.status;
}

export function previewDto(env: AppEnv, p: SimulatorPreviewRow, staff: boolean, display: "embed" | "link" = "embed") {
  const state = previewState(p);
  return {
    id: p.id, build_id: p.build_id, project_id: p.project_id, status: state, enabled: !!p.enabled, status_detail: p.status_detail, error_code: p.error_code, attempts: p.attempts,
    file_type: p.file_type, mode: p.mode, device: p.device, os_version: p.os_version, expires_at: p.expires_at, uploaded_at: p.uploaded_at, ready_at: p.ready_at, created_at: p.created_at,
    appetize_configured: appetizeConfigured(env),
    display,
    ...(staff && p.appetize_public_key && state === "ready" ? { embed_url: embedUrl(p.appetize_public_key, p.device, p.os_version), open_url: hostedUrl(p.appetize_public_key, p.device, p.os_version) } : {}),
  };
}

async function loadPreview(env: AppEnv, buildId: string): Promise<SimulatorPreviewRow> {
  const p = await one<SimulatorPreviewRow>(env.DB, "SELECT * FROM simulator_previews WHERE build_id = ?", buildId);
  if (!p) throw notFound("Simulator preview");
  return p;
}

export async function getBuildPreview(env: AppEnv, actor: Actor, buildId: string) {
  const { build } = await loadBuild(env, actor, buildId, "build:view_internal");
  if (build.build_kind !== "simulator") throw notFound("Simulator preview");
  return previewDto(env, await loadPreview(env, buildId), true, (await getSettings(env)).previewDisplay);
}

export async function listProjectPreviews(env: AppEnv, actor: Actor, projectId: string) {
  await loadProject(env, actor, projectId, "build:view_internal");
  const rows = await all<SimulatorPreviewRow & { version: string | null; build_number: string | null; app_name: string | null; release_title: string | null; uploader: string | null }>(env.DB,
    `SELECT sp.*, b.version, b.build_number, b.app_name, b.release_title, u.display_name AS uploader FROM simulator_previews sp JOIN builds b ON b.id = sp.build_id AND b.deleted_at IS NULL
       LEFT JOIN users u ON u.id = sp.created_by WHERE sp.project_id = ? ORDER BY sp.created_at DESC LIMIT 200`, projectId);
  return { appetizeConfigured: appetizeConfigured(env), items: rows.map((r) => ({ ...previewDto(env, r, true), version: r.version, build_number: r.build_number, app_name: r.app_name, release_title: r.release_title, uploader: r.uploader })) };
}

// ---------------------------------------------------------------- management
export async function retryPreview(env: AppEnv, actor: Actor, buildId: string, req?: Request) {
  const { build } = await loadBuild(env, actor, buildId, "build:upload");
  if (build.build_kind !== "simulator") throw notFound("Simulator preview");
  const p = await loadPreview(env, buildId);
  if (!["failed", "pending"].includes(p.status)) throw new ApiError("INVALID_STATE", `A preview that is "${p.status}" cannot be retried.`);
  await run(env.DB, "UPDATE simulator_previews SET status = 'pending', attempts = 0, next_attempt_at = NULL, error_code = NULL, status_detail = 'Retry requested.', updated_at = ? WHERE id = ?", nowIso(), p.id);
  await audit(env, { organisationId: build.organisation_id, actorUserId: actor.userId, action: "simulator_preview.retry", resourceType: "build", resourceId: buildId, req });
  if (!(await enqueuePreview(env, p.id))) await runPreviewUpload(env, p.id);
  return previewDto(env, await loadPreview(env, buildId), true);
}

export async function updatePreview(env: AppEnv, actor: Actor, buildId: string, patch: { device?: string; expiresAt?: string | null; enabled?: boolean }, req?: Request) {
  const { build } = await loadBuild(env, actor, buildId, "distribution:manage");
  if (build.build_kind !== "simulator") throw notFound("Simulator preview");
  const p = await loadPreview(env, buildId);
  if (p.status === "deleted") throw new ApiError("INVALID_STATE", "This preview was deleted.");
  if (patch.device !== undefined && !IOS_DEVICES.includes(patch.device as never)) throw new ApiError("VALIDATION_ERROR", "Unknown device.");
  if (patch.expiresAt && new Date(patch.expiresAt) <= new Date()) throw new ApiError("VALIDATION_ERROR", "The expiry must be in the future.");
  const sets: string[] = []; const args: unknown[] = [];
  if (patch.device !== undefined) { sets.push("device = ?"); args.push(patch.device); }
  if (patch.expiresAt !== undefined) { sets.push("expires_at = ?"); args.push(patch.expiresAt); }
  if (patch.enabled !== undefined) { sets.push("enabled = ?"); args.push(patch.enabled ? 1 : 0); }
  if (!sets.length) return previewDto(env, p, true);
  await run(env.DB, `UPDATE simulator_previews SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`, ...args, nowIso(), p.id);
  // The Appetize key may be shared by anyone who has it, so also stop/start streaming on Appetize itself (best effort).
  if (p.appetize_public_key && p.status === "ready" && (patch.enabled !== undefined || patch.expiresAt !== undefined)) {
    const next = (await loadPreview(env, buildId));
    const live = !!next.enabled && !(next.expires_at && next.expires_at < nowIso());
    try {
      if (live || !(await keyShared(env, p.appetize_public_key, p.id))) { await setAppDisabled(env, p.appetize_public_key, !live); await run(env.DB, "UPDATE simulator_previews SET appetize_disabled = ? WHERE id = ?", live ? 0 : 1, p.id); }
    } catch (e) { console.error(`simulator preview ${p.id}: could not ${live ? "enable" : "disable"} the Appetize app (${(e as AppetizeError).code ?? "error"})`); }
  }
  await audit(env, { organisationId: build.organisation_id, actorUserId: actor.userId, action: "simulator_preview.updated", resourceType: "build", resourceId: buildId, metadata: { fields: Object.keys(patch) }, req });
  return previewDto(env, await loadPreview(env, buildId), true);
}

export async function deletePreview(env: AppEnv, actor: Actor, buildId: string, req?: Request) {
  const { build } = await loadBuild(env, actor, buildId, "build:delete");
  if (build.build_kind !== "simulator") throw notFound("Simulator preview");
  const p = await loadPreview(env, buildId);
  if (p.appetize_public_key && !(await keyShared(env, p.appetize_public_key, p.id))) {
    try { await deleteApp(env, p.appetize_public_key); }
    catch (e) { if (!(e instanceof AppetizeError) || e.code !== "NOT_FOUND") throw new ApiError("INTERNAL_ERROR", e instanceof AppetizeError ? e.message : "Appetize could not delete the app.", { retryable: true }, 502); }
  }
  const now = nowIso();
  await batch(env.DB, [
    stmt(env.DB, "UPDATE simulator_previews SET status = 'deleted', status_detail = 'Preview deleted.', appetize_public_key = NULL, enabled = 0, updated_at = ? WHERE id = ?", now, p.id),
    stmt(env.DB, "UPDATE distribution_links SET status = 'revoked', revoked_at = ? WHERE build_id = ? AND kind = 'preview' AND status != 'revoked'", now, buildId),
  ]);
  await audit(env, { organisationId: build.organisation_id, actorUserId: actor.userId, action: "simulator_preview.deleted", resourceType: "build", resourceId: buildId, req });
  return { id: buildId, deleted: true };
}

/** Called when a simulator build itself is deleted: remove its Appetize app unless another preview shares it. Never blocks the delete. */
export async function cleanupPreviewForBuild(env: AppEnv, buildId: string): Promise<void> {
  const p = await one<SimulatorPreviewRow>(env.DB, "SELECT * FROM simulator_previews WHERE build_id = ?", buildId);
  if (!p || p.status === "deleted") return;
  try { if (p.appetize_public_key && !(await keyShared(env, p.appetize_public_key, p.id))) await deleteApp(env, p.appetize_public_key); } catch { /* best effort */ }
  await run(env.DB, "UPDATE simulator_previews SET status = 'deleted', enabled = 0, appetize_public_key = NULL, updated_at = ? WHERE id = ?", nowIso(), p.id);
}

// ---------------------------------------------------------------- client view
/** Safe data for the client preview page. Call only after link access has been granted. */
export async function previewPublicView(env: AppEnv, buildId: string) {
  const p = await one<SimulatorPreviewRow>(env.DB, "SELECT * FROM simulator_previews WHERE build_id = ?", buildId);
  if (!p) return { available: false as const, reason: "This preview is not available." };
  const state = previewState(p);
  if (state === "expired") return { available: false as const, reason: "This preview has expired." };
  if (state === "disabled" || state === "deleted") return { available: false as const, reason: "This preview has been turned off." };
  if (state !== "ready" || !p.appetize_public_key) return { available: false as const, reason: "This preview is still being prepared. Please check again in a few minutes." };
  const display = (await getSettings(env)).previewDisplay;
  return { available: true as const, display, embedUrl: embedUrl(p.appetize_public_key, p.device, p.os_version), openUrl: hostedUrl(p.appetize_public_key, p.device, p.os_version), device: p.device };
}
