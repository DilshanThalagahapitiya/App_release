import type { AppEnv } from "@/lib/env";
import type { Actor } from "@/lib/auth";
import { all, one, run, stmt, batch, likeTerm, type Page } from "@/lib/db";
import { ApiError, forbidden, notFound } from "@/lib/errors";
import { newId, sha256Hex } from "@/lib/crypto";
import { nowIso } from "@/lib/time";
import { canTransition, type FeedbackStatus } from "@/lib/rules";
import { audit } from "@/lib/audit";
import { loadFeedback, loadProject } from "@/lib/access";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { keys, sniffImageType, signedFileUrl } from "@/lib/storage";
import { notify, projectStaffIds } from "@/lib/notify";
import type { FeedbackRow } from "@/lib/types";

export async function createFeedback(env: AppEnv, actor: Actor, projectId: string, input: {
  buildId?: string | null; category: string; title: string; description: string; severity: string; reproductionSteps?: string | null; expectedResult?: string | null;
  actualResult?: string | null; deviceModel?: string | null; iosVersion?: string | null; contactPreference: string;
}, req?: Request) {
  const { project } = await loadProject(env, actor, projectId, "feedback:create");
  if (!project.feedback_enabled) throw new ApiError("INVALID_STATE", "Feedback is disabled for this project.");
  if (input.buildId) {
    const b = await one(env.DB, "SELECT id FROM builds WHERE id = ? AND project_id = ? AND deleted_at IS NULL", input.buildId, projectId);
    if (!b) throw new ApiError("VALIDATION_ERROR", "The selected build does not belong to this project.");
  }
  const id = newId(); const now = nowIso();
  await batch(env.DB, [
    stmt(env.DB, `INSERT INTO feedback (id, organisation_id, project_id, build_id, reporter_user_id, category, title, description, severity, status, device_model, ios_version, reproduction_steps, expected_result, actual_result, contact_preference, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?, 'new', ?,?,?,?,?,?,?,?)`,
      id, project.organisation_id, projectId, input.buildId ?? null, actor.userId, input.category, input.title, input.description, input.severity,
      input.deviceModel ?? null, input.iosVersion ?? null, input.reproductionSteps ?? null, input.expectedResult ?? null, input.actualResult ?? null, input.contactPreference, now, now),
    stmt(env.DB, "INSERT INTO feedback_status_history (id, feedback_id, changed_by, old_status, new_status, created_at) VALUES (?,?,?,?,?,?)", newId(), id, actor.userId, null, "new", now),
  ]);
  await audit(env, { organisationId: project.organisation_id, actorUserId: actor.userId, action: "feedback.submitted", resourceType: "feedback", resourceId: id, metadata: { severity: input.severity }, req });
  await notify(env, { userIds: (await projectStaffIds(env, projectId, project.organisation_id)).filter((u) => u !== actor.userId), organisationId: project.organisation_id, type: "feedback_received", title: `New ${input.severity} feedback: ${input.title}`, resourceType: "feedback", resourceId: id, path: `/app/feedback/${id}` });
  return { id, status: "new" };
}

const FB_SORTS: Record<string, string> = { created: "f.created_at DESC", updated: "f.updated_at DESC", severity: "CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, f.created_at DESC" };

export async function listFeedback(env: AppEnv, actor: Actor, scope: { projectId?: string }, q: { page: number; pageSize: number; q?: string; status?: string; severity?: string; category?: string; buildId?: string; assignee?: string; sort?: string }): Promise<Page<unknown>> {
  const { accessibleProjects } = await import("@/lib/access");
  const accessible = (await accessibleProjects(env, actor)).filter((p) => (!scope.projectId || p.id === scope.projectId) && (can(p.role, "feedback:view_all") || can(p.role, "feedback:view_own")));
  if (scope.projectId && !accessible.length) await loadProject(env, actor, scope.projectId, "feedback:view_own"); // throws the right error
  if (!accessible.length) return { items: [], page: q.page, pageSize: q.pageSize, total: 0 };
  // Per-project visibility: managers/viewers see all; testers only their own reports.
  const clauses: string[] = []; const params: unknown[] = [];
  for (const p of accessible) {
    if (can(p.role, "feedback:view_all")) { clauses.push("f.project_id = ?"); params.push(p.id); }
    else { clauses.push("(f.project_id = ? AND f.reporter_user_id = ?)"); params.push(p.id, actor.userId); }
  }
  const where = [`(${clauses.join(" OR ")})`];
  if (q.status) { where.push("f.status = ?"); params.push(q.status); }
  if (q.severity) { where.push("f.severity = ?"); params.push(q.severity); }
  if (q.category) { where.push("f.category = ?"); params.push(q.category); }
  if (q.buildId) { where.push("f.build_id = ?"); params.push(q.buildId); }
  if (q.assignee) { where.push("f.assigned_to_user_id = ?"); params.push(q.assignee); }
  if (q.q) { const t = likeTerm(q.q); where.push("(f.title LIKE ? ESCAPE '\\' OR f.description LIKE ? ESCAPE '\\')"); params.push(t, t); }
  const W = where.join(" AND ");
  const total = (await one<{ n: number }>(env.DB, `SELECT COUNT(*) AS n FROM feedback f WHERE ${W}`, ...params))?.n ?? 0;
  const items = await all(env.DB, `SELECT f.id, f.project_id, f.build_id, f.category, f.title, f.severity, f.status, f.assigned_to_user_id, f.created_at, f.updated_at, p.name AS project_name, b.version, b.build_number, ru.display_name AS reporter_name, au.display_name AS assignee_name
    FROM feedback f JOIN projects p ON p.id = f.project_id LEFT JOIN builds b ON b.id = f.build_id LEFT JOIN users ru ON ru.id = f.reporter_user_id LEFT JOIN users au ON au.id = f.assigned_to_user_id
    WHERE ${W} ORDER BY ${FB_SORTS[q.sort ?? "created"] ?? FB_SORTS.created} LIMIT ? OFFSET ?`, ...params, q.pageSize, (q.page - 1) * q.pageSize);
  return { items, page: q.page, pageSize: q.pageSize, total };
}

export async function getFeedback(env: AppEnv, actor: Actor, feedbackId: string) {
  const { feedback, role, project } = await loadFeedback(env, actor, feedbackId);
  const manage = can(role, "feedback:manage"); const staffView = can(role, "feedback:comment_internal") || can(role, "feedback:view_all");
  const comments = await all(env.DB, `SELECT c.id, c.body, c.visibility, c.created_at, u.display_name AS author_name, c.author_user_id FROM feedback_comments c LEFT JOIN users u ON u.id = c.author_user_id
    WHERE c.feedback_id = ? ${can(role, "feedback:comment_internal") ? "" : "AND c.visibility = 'customer'"} ORDER BY c.created_at`, feedbackId);
  const attachments = await all(env.DB, "SELECT id, original_filename, mime_type, size_bytes, created_at FROM feedback_attachments WHERE feedback_id = ? AND status = 'ready' ORDER BY created_at", feedbackId);
  const history = await all(env.DB, `SELECT h.id, h.old_status, h.new_status, ${staffView ? "h.note" : "CASE WHEN h.note IS NULL THEN NULL ELSE h.note END AS note"}, h.created_at, u.display_name AS changed_by_name
    FROM feedback_status_history h LEFT JOIN users u ON u.id = h.changed_by WHERE h.feedback_id = ? ORDER BY h.created_at`, feedbackId);
  const build = feedback.build_id ? await one(env.DB, "SELECT id, version, build_number, app_name FROM builds WHERE id = ?", feedback.build_id) : null;
  const reporter = feedback.reporter_user_id ? await one(env.DB, "SELECT display_name, email FROM users WHERE id = ?", feedback.reporter_user_id) : null;
  return { ...feedback, project_name: project.name, build, reporter: reporter ? { display_name: (reporter as { display_name: string }).display_name, ...(manage ? { email: (reporter as { email: string }).email } : {}) } : null, comments, attachments, history, permissions: { canManage: manage, canInternalComment: can(role, "feedback:comment_internal") } };
}

export async function updateFeedback(env: AppEnv, actor: Actor, feedbackId: string, patch: { severity?: string; assignedToUserId?: string | null; category?: string }, req?: Request) {
  const { feedback, role, project } = await loadFeedback(env, actor, feedbackId);
  if (!can(role, "feedback:manage")) throw forbidden();
  if (patch.assignedToUserId) {
    const staff = await projectStaffIds(env, project.id, project.organisation_id);
    if (!staff.includes(patch.assignedToUserId)) throw new ApiError("VALIDATION_ERROR", "The assignee must be a staff member of this project.");
  }
  const sets: string[] = []; const vals: unknown[] = [];
  if (patch.severity) { sets.push("severity = ?"); vals.push(patch.severity); }
  if (patch.category) { sets.push("category = ?"); vals.push(patch.category); }
  if (patch.assignedToUserId !== undefined) { sets.push("assigned_to_user_id = ?"); vals.push(patch.assignedToUserId); }
  if (sets.length) await run(env.DB, `UPDATE feedback SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`, ...vals, nowIso(), feedbackId);
  await audit(env, { organisationId: feedback.organisation_id, actorUserId: actor.userId, action: "feedback.updated", resourceType: "feedback", resourceId: feedbackId, metadata: patch, req });
  return getFeedback(env, actor, feedbackId);
}

export async function changeStatus(env: AppEnv, actor: Actor, feedbackId: string, input: { status: FeedbackStatus; note?: string | null }, req?: Request) {
  const { feedback, role } = await loadFeedback(env, actor, feedbackId);
  if (!can(role, "feedback:manage")) throw forbidden();
  const from = feedback.status as FeedbackStatus;
  if (!canTransition(from, input.status)) throw new ApiError("INVALID_STATE", `Cannot move feedback from ${from} to ${input.status}.`);
  const now = nowIso();
  await batch(env.DB, [
    stmt(env.DB, "UPDATE feedback SET status = ?, updated_at = ?, resolved_at = CASE WHEN ? IN ('resolved','closed') THEN COALESCE(resolved_at, ?) ELSE NULL END WHERE id = ?", input.status, now, input.status, now, feedbackId),
    stmt(env.DB, "INSERT INTO feedback_status_history (id, feedback_id, changed_by, old_status, new_status, note, created_at) VALUES (?,?,?,?,?,?,?)", newId(), feedbackId, actor.userId, from, input.status, input.note ?? null, now),
  ]);
  await audit(env, { organisationId: feedback.organisation_id, actorUserId: actor.userId, action: "feedback.status_changed", resourceType: "feedback", resourceId: feedbackId, metadata: { from, to: input.status }, req });
  if (feedback.reporter_user_id && feedback.reporter_user_id !== actor.userId)
    await notify(env, { userIds: [feedback.reporter_user_id], organisationId: feedback.organisation_id, type: "feedback_status_changed", title: `Your feedback is now ${input.status.replace(/_/g, " ")}`, body: feedback.title, resourceType: "feedback", resourceId: feedbackId, path: `/portal/feedback/${feedbackId}` });
  return getFeedback(env, actor, feedbackId);
}

export async function addComment(env: AppEnv, actor: Actor, feedbackId: string, input: { body: string; visibility: "internal" | "customer" }, req?: Request) {
  const { feedback, role } = await loadFeedback(env, actor, feedbackId);
  const staff = can(role, "feedback:comment_internal");
  if (input.visibility === "internal" && !staff) throw forbidden("Only staff can write internal comments.");
  const visibility = staff ? input.visibility : "customer";
  const id = newId(); const now = nowIso();
  await run(env.DB, "INSERT INTO feedback_comments (id, feedback_id, author_user_id, body, visibility, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", id, feedbackId, actor.userId, input.body, visibility, now, now);
  await run(env.DB, "UPDATE feedback SET updated_at = ? WHERE id = ?", now, feedbackId);
  await audit(env, { organisationId: feedback.organisation_id, actorUserId: actor.userId, action: "feedback.commented", resourceType: "feedback", resourceId: feedbackId, metadata: { visibility }, req });
  if (visibility === "customer") {
    const targets = staff ? (feedback.reporter_user_id ? [feedback.reporter_user_id] : []) : await projectStaffIds(env, feedback.project_id, feedback.organisation_id);
    await notify(env, { userIds: targets.filter((u) => u !== actor.userId), organisationId: feedback.organisation_id, type: "feedback_reply", title: `New reply on: ${feedback.title}`, resourceType: "feedback", resourceId: feedbackId, path: staff ? `/portal/feedback/${feedbackId}` : `/app/feedback/${feedbackId}` });
  }
  return { id, visibility };
}

// ------------------------------------------------------------ attachments

const MAX_ATTACHMENTS = 6;

export async function createAttachmentSession(env: AppEnv, actor: Actor, feedbackId: string, input: { filename: string; mimeType: string; sizeBytes: number }) {
  const { feedback, role } = await loadFeedback(env, actor, feedbackId);
  if (!(feedback.reporter_user_id === actor.userId || can(role, "feedback:manage"))) throw forbidden();
  const s = await getSettings(env);
  if (!s.allowedAttachmentTypes.includes(input.mimeType)) throw new ApiError("UNSUPPORTED_MEDIA", `Attachment type ${input.mimeType} is not allowed.`, { allowed: s.allowedAttachmentTypes });
  if (input.sizeBytes > s.maxAttachmentBytes) throw new ApiError("PAYLOAD_TOO_LARGE", `Attachments are limited to ${s.maxAttachmentBytes} bytes.`);
  const count = (await one<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM feedback_attachments WHERE feedback_id = ? AND status != 'rejected'", feedbackId))?.n ?? 0;
  if (count >= MAX_ATTACHMENTS) throw new ApiError("CONFLICT", `A maximum of ${MAX_ATTACHMENTS} attachments is allowed per report.`);
  const id = newId();
  await run(env.DB, "INSERT INTO feedback_attachments (id, feedback_id, uploaded_by, r2_object_key, original_filename, mime_type, size_bytes, status, created_at) VALUES (?,?,?,?,?,?,?, 'pending', ?)",
    id, feedbackId, actor.userId, keys.attachment(feedback.organisation_id, feedbackId, id), input.filename.slice(0, 255), input.mimeType, input.sizeBytes, nowIso());
  return { attachmentId: id, uploadPath: `/api/v1/feedback-attachments/${id}/content`, maxBytes: input.sizeBytes };
}

export async function receiveAttachment(env: AppEnv, actor: Actor, attachmentId: string, data: ArrayBuffer, req?: Request) {
  const a = await one<{ id: string; feedback_id: string; uploaded_by: string; r2_object_key: string; mime_type: string; size_bytes: number; status: string }>(env.DB, "SELECT * FROM feedback_attachments WHERE id = ?", attachmentId);
  if (!a || a.uploaded_by !== actor.userId) throw notFound("Attachment");
  if (a.status !== "pending") throw new ApiError("INVALID_STATE", "This attachment has already been uploaded.");
  const { feedback } = await loadFeedback(env, actor, a.feedback_id);
  const reject = async (msg: string, code: "UNSUPPORTED_MEDIA" | "PAYLOAD_TOO_LARGE" | "VALIDATION_ERROR"): Promise<never> => {
    await run(env.DB, "UPDATE feedback_attachments SET status = 'rejected' WHERE id = ?", attachmentId);
    throw new ApiError(code, msg);
  };
  const settings = await getSettings(env);
  if (data.byteLength > settings.maxAttachmentBytes) return reject("Attachment is too large.", "PAYLOAD_TOO_LARGE");
  if (data.byteLength !== a.size_bytes) return reject("Uploaded size does not match the declared size.", "VALIDATION_ERROR");
  // Never trust the declared type: sniff the magic bytes and require they match.
  const sniffed = sniffImageType(new Uint8Array(data.slice(0, 16)));
  if (!sniffed || sniffed !== a.mime_type) return reject("File content does not match an allowed image type.", "UNSUPPORTED_MEDIA");
  await env.BUCKET.put(a.r2_object_key, data, { httpMetadata: { contentType: sniffed, contentDisposition: "attachment" } });
  await run(env.DB, "UPDATE feedback_attachments SET status = 'ready', sha256 = ? WHERE id = ?", await sha256Hex(data), attachmentId);
  await audit(env, { organisationId: feedback.organisation_id, actorUserId: actor.userId, action: "feedback.attachment_added", resourceType: "feedback", resourceId: feedback.id, req });
  return { id: attachmentId, status: "ready" };
}

export async function attachmentUrl(env: AppEnv, actor: Actor, attachmentId: string) {
  const a = await one<{ id: string; feedback_id: string; status: string }>(env.DB, "SELECT id, feedback_id, status FROM feedback_attachments WHERE id = ?", attachmentId);
  if (!a || a.status !== "ready") throw notFound("Attachment");
  await loadFeedback(env, actor, a.feedback_id); // enforces tenant/project/reporter scoping
  return { url: await signedFileUrl(env, { k: "attachment", id: attachmentId, uid: actor.userId }, 300), expiresInSeconds: 300 };
}

export type { FeedbackRow };
