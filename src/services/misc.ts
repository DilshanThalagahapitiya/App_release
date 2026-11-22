import type { AppEnv } from "@/lib/env";
import type { Actor } from "@/lib/auth";
import { revokeAllSessions } from "@/lib/auth";
import { all, one, run, type Page } from "@/lib/db";
import { ApiError, forbidden } from "@/lib/errors";
import { hashPassword, hashToken, newId, randomToken } from "@/lib/crypto";
import { addSeconds, nowIso } from "@/lib/time";
import { accessibleProjects, orgIdsForActor, placeholders } from "@/lib/access";
import { can, isStaffRole } from "@/lib/permissions";
import { queueEmail, emailConfigured } from "@/lib/email";
import { audit } from "@/lib/audit";
import { processingStats } from "./worker";
import { linkState } from "@/lib/rules";
import { getSettings } from "@/lib/settings";

// ------------------------------------------------------------ session / profile

export async function me(env: AppEnv, actor: Actor) {
  const memberships = await all<{ organisation_id: string; name: string; role: string }>(env.DB,
    `SELECT m.organisation_id, o.name, m.role FROM organisation_members m JOIN organisations o ON o.id = m.organisation_id WHERE m.user_id = ? AND m.status = 'active' AND o.status = 'active'`, actor.userId);
  const projects = await accessibleProjects(env, actor);
  const staff = actor.isPlatformOwner || projects.some((p) => isStaffRole(p.role)) || memberships.some((m) => m.role === "org_admin");
  const unread = (await one<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL", actor.userId))?.n ?? 0;
  return {
    id: actor.userId, email: actor.email, displayName: actor.displayName, isPlatformOwner: actor.isPlatformOwner, memberships,
    portal: staff ? "admin" : "customer", unreadNotifications: unread, emailConfigured: emailConfigured(env),
  };
}

// ------------------------------------------------------------ password reset

export async function requestPasswordReset(env: AppEnv, req: Request, email: string) {
  const user = await one<{ id: string; status: string }>(env.DB, "SELECT id, status FROM users WHERE email = ?", email);
  // Response is identical whether or not the account exists (no enumeration).
  if (user && user.status === "active") {
    const token = randomToken(32);
    await run(env.DB, "INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at) VALUES (?,?,?,?,?)", newId(), user.id, await hashToken(token), addSeconds(3600), nowIso());
    await queueEmail(env, { to: email, template: "password_reset", subject: "Reset your password", text: `Use this link within 1 hour to choose a new password:\n${env.APP_URL}/auth/reset-password?token=${token}\n\nIf you did not request this, ignore this email.` });
    await audit(env, { actorUserId: user.id, action: "auth.password_reset_requested", resourceType: "user", resourceId: user.id, req });
  }
  return { message: "If an account exists for that address, a reset link has been sent (when email delivery is configured)." };
}

export async function resetPassword(env: AppEnv, req: Request, token: string, password: string) {
  const row = await one<{ id: string; user_id: string }>(env.DB, "UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING id, user_id", nowIso(), await hashToken(token), nowIso());
  if (!row) throw new ApiError("INVALID_STATE", "This reset link is invalid, expired or already used.");
  await run(env.DB, "UPDATE users SET password_hash = ?, failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?", await hashPassword(password), nowIso(), row.user_id);
  await revokeAllSessions(env, row.user_id); // every existing session is invalidated
  await audit(env, { actorUserId: row.user_id, action: "auth.password_reset", resourceType: "user", resourceId: row.user_id, req });
  return { reset: true };
}

// ------------------------------------------------------------ notifications

export async function listNotifications(env: AppEnv, actor: Actor, q: { page: number; pageSize: number; unread?: boolean }): Promise<Page<unknown> & { unread: number }> {
  const where = "user_id = ?" + (q.unread ? " AND read_at IS NULL" : "");
  const total = (await one<{ n: number }>(env.DB, `SELECT COUNT(*) AS n FROM notifications WHERE ${where}`, actor.userId))?.n ?? 0;
  const items = await all(env.DB, `SELECT id, type, title, body, resource_type, resource_id, email_state, read_at, created_at FROM notifications WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, actor.userId, q.pageSize, (q.page - 1) * q.pageSize);
  const unread = (await one<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL", actor.userId))?.n ?? 0;
  return { items, page: q.page, pageSize: q.pageSize, total, unread };
}
export async function markRead(env: AppEnv, actor: Actor, id: string) {
  await run(env.DB, "UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?", nowIso(), id, actor.userId);
  return { id, read: true };
}
export async function markAllRead(env: AppEnv, actor: Actor) {
  await run(env.DB, "UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL", nowIso(), actor.userId);
  return { read: true };
}
export async function getPreferences(env: AppEnv, actor: Actor) {
  return all(env.DB, "SELECT event_type, in_app_enabled, email_enabled FROM notification_preferences WHERE user_id = ?", actor.userId);
}
export async function setPreference(env: AppEnv, actor: Actor, eventType: string, inApp: boolean, email: boolean) {
  await run(env.DB, "INSERT INTO notification_preferences (id, user_id, event_type, in_app_enabled, email_enabled, updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id, event_type) DO UPDATE SET in_app_enabled = excluded.in_app_enabled, email_enabled = excluded.email_enabled, updated_at = excluded.updated_at",
    newId(), actor.userId, eventType, inApp ? 1 : 0, email ? 1 : 0, nowIso());
  return { eventType, inApp, email };
}

// ------------------------------------------------------------ audit logs

export async function listAuditLogs(env: AppEnv, actor: Actor, q: { page: number; pageSize: number; action?: string; resourceType?: string; actorId?: string; from?: string; to?: string; organisationId?: string }): Promise<Page<unknown>> {
  const orgs = (await orgIdsForActor(env, actor)).filter(() => true);
  // Only org admins (and the Platform Owner) may read audit logs; others see nothing.
  const adminOrgs: string[] = [];
  if (actor.isPlatformOwner) adminOrgs.push(...orgs);
  else adminOrgs.push(...(await all<{ organisation_id: string }>(env.DB, "SELECT organisation_id FROM organisation_members WHERE user_id = ? AND status = 'active' AND role = 'org_admin'", actor.userId)).map((r) => r.organisation_id));
  if (!adminOrgs.length) throw forbidden("Audit logs are available to organisation administrators.");
  const scoped = q.organisationId ? adminOrgs.filter((o) => o === q.organisationId) : adminOrgs;
  if (!scoped.length) throw forbidden();
  const where = [`(a.organisation_id IN (${placeholders(scoped.length)})${actor.isPlatformOwner && !q.organisationId ? " OR a.organisation_id IS NULL" : ""})`]; const params: unknown[] = [...scoped];
  if (q.action) { where.push("a.action LIKE ?"); params.push(q.action.replace(/[%_\\]/g, "") + "%"); }
  if (q.resourceType) { where.push("a.resource_type = ?"); params.push(q.resourceType); }
  if (q.actorId) { where.push("a.actor_user_id = ?"); params.push(q.actorId); }
  if (q.from) { where.push("a.created_at >= ?"); params.push(q.from); }
  if (q.to) { where.push("a.created_at <= ?"); params.push(q.to); }
  const W = where.join(" AND ");
  const total = (await one<{ n: number }>(env.DB, `SELECT COUNT(*) AS n FROM audit_logs a WHERE ${W}`, ...params))?.n ?? 0;
  const items = await all(env.DB, `SELECT a.id, a.organisation_id, a.actor_user_id, a.actor_type, a.action, a.resource_type, a.resource_id, a.metadata_json, a.created_at, u.display_name AS actor_name
    FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id WHERE ${W} ORDER BY a.created_at DESC, a.id LIMIT ? OFFSET ?`, ...params, q.pageSize, (q.page - 1) * q.pageSize);
  return { items, page: q.page, pageSize: q.pageSize, total };
}

const csvCell = (v: unknown) => { const s = v == null ? "" : String(v); return /^[=+\-@\t\r]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function auditCsv(items: Record<string, unknown>[]): string {
  const cols = ["created_at", "actor_name", "actor_type", "action", "resource_type", "resource_id", "metadata_json"];
  return [cols.join(","), ...items.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n");
}

// ------------------------------------------------------------ dashboard

export async function overview(env: AppEnv, actor: Actor) {
  const projects = await accessibleProjects(env, actor);
  const ids = projects.map((p) => p.id);
  if (!ids.length) return { empty: true, totals: { projects: 0, builds: 0, publishedBuilds: 0, awaitingValidation: 0, failedValidation: 0, activeUsers: 0, openFeedback: 0 }, recentDownloads: [], recentActivity: [], downloadsByDay: [], feedbackBySeverity: [], buildsByEligibility: [], processing: actor.isPlatformOwner ? await processingStats(env) : null };
  const P = placeholders(ids.length);
  const t = await one<Record<string, number>>(env.DB, `SELECT
      (SELECT COUNT(*) FROM projects WHERE id IN (${P})) AS projects,
      (SELECT COUNT(*) FROM builds WHERE project_id IN (${P}) AND deleted_at IS NULL) AS builds,
      (SELECT COUNT(*) FROM builds WHERE project_id IN (${P}) AND deleted_at IS NULL AND publish_status = 'published') AS publishedBuilds,
      (SELECT COUNT(*) FROM builds WHERE project_id IN (${P}) AND deleted_at IS NULL AND validation_status IN ('pending','running')) AS awaitingValidation,
      (SELECT COUNT(*) FROM builds WHERE project_id IN (${P}) AND deleted_at IS NULL AND validation_status = 'failed') AS failedValidation,
      (SELECT COUNT(DISTINCT user_id) FROM project_members WHERE project_id IN (${P}) AND status = 'active') AS activeUsers,
      (SELECT COUNT(*) FROM feedback WHERE project_id IN (${P}) AND status NOT IN ('resolved','closed')) AS openFeedback`,
    ...ids, ...ids, ...ids, ...ids, ...ids, ...ids, ...ids);
  const since = addSeconds(-30 * 86400);
  const downloadsByDay = await all(env.DB, `SELECT substr(d.created_at, 1, 10) AS day, COUNT(*) AS count FROM downloads d JOIN builds b ON b.id = d.build_id WHERE b.project_id IN (${P}) AND d.event_type IN ('download_started','manifest_requested') AND d.created_at >= ? GROUP BY day ORDER BY day`, ...ids, since);
  const feedbackBySeverity = await all(env.DB, `SELECT severity, COUNT(*) AS count FROM feedback WHERE project_id IN (${P}) AND status NOT IN ('resolved','closed') GROUP BY severity`, ...ids);
  const buildsByEligibility = await all(env.DB, `SELECT eligibility_status AS status, COUNT(*) AS count FROM builds WHERE project_id IN (${P}) AND deleted_at IS NULL GROUP BY eligibility_status`, ...ids);
  const recentDownloads = await all(env.DB, `SELECT d.id, d.event_type, d.created_at, d.user_agent_summary, b.version, b.build_number, p.name AS project_name, u.display_name AS user_name
    FROM downloads d JOIN builds b ON b.id = d.build_id JOIN projects p ON p.id = b.project_id LEFT JOIN users u ON u.id = d.user_id
    WHERE b.project_id IN (${P}) AND d.event_type IN ('download_started','manifest_requested','install_confirmed') ORDER BY d.created_at DESC LIMIT 8`, ...ids);
  const adminOrgIds = actor.isPlatformOwner ? await orgIdsForActor(env, actor) : (await all<{ organisation_id: string }>(env.DB, "SELECT organisation_id FROM organisation_members WHERE user_id = ? AND status = 'active' AND role = 'org_admin'", actor.userId)).map((r) => r.organisation_id);
  const recentActivity = adminOrgIds.length ? await all(env.DB, `SELECT a.id, a.action, a.resource_type, a.resource_id, a.created_at, u.display_name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
    WHERE a.organisation_id IN (${placeholders(adminOrgIds.length)}) ORDER BY a.created_at DESC LIMIT 8`, ...adminOrgIds) : [];
  return { empty: false, totals: t, downloadsByDay, feedbackBySeverity, buildsByEligibility, recentDownloads, recentActivity, processing: actor.isPlatformOwner ? await processingStats(env) : null, validationMode: (await getSettings(env)).validationMode };
}

// ------------------------------------------------------------ customer portal

export async function portalBuilds(env: AppEnv, actor: Actor) {
  const projects = (await accessibleProjects(env, actor)).filter((p) => can(p.role, "build:view"));
  if (!projects.length) return [];
  const ids = projects.map((p) => p.id);
  const rows = await all<{ link_id: string; link_status: string; expires_at: string | null; max_downloads: number | null; download_count: number; access_scope: string; project_id: string; project_name: string; build_id: string; app_name: string | null; version: string | null; build_number: string | null; eligibility_status: string; published_at: string | null; release_title: string | null; allow_feedback: number }>(env.DB,
    `SELECT l.id AS link_id, l.status AS link_status, l.expires_at, l.max_downloads, l.download_count, l.access_scope, l.allow_feedback, p.id AS project_id, p.name AS project_name, b.id AS build_id, b.app_name, b.version, b.build_number, b.eligibility_status, b.published_at, b.release_title
       FROM distribution_links l JOIN builds b ON b.id = l.build_id AND b.deleted_at IS NULL AND b.publish_status = 'published' JOIN projects p ON p.id = l.project_id AND p.status = 'active'
      WHERE l.project_id IN (${placeholders(ids.length)}) AND l.status = 'active' AND l.access_scope IN ('project_members','named_users')
        AND (l.access_scope = 'project_members' OR EXISTS (SELECT 1 FROM distribution_link_members m WHERE m.distribution_link_id = l.id AND m.user_id = ?))
      ORDER BY b.published_at DESC`, ...ids, actor.userId);
  const { derivePublicToken } = await import("./distribution");
  const out = [];
  for (const r of rows) {
    if (linkState({ status: r.link_status, expires_at: r.expires_at, max_downloads: r.max_downloads, download_count: r.download_count }) !== "active") continue;
    out.push({ ...r, path: `/d/${await derivePublicToken(env, r.link_id)}` });
  }
  return out;
}

export async function health(env: AppEnv, detailed: boolean) {
  const db = await one<{ ok: number }>(env.DB, "SELECT 1 AS ok").then((r) => r?.ok === 1).catch(() => false);
  const base = { status: db ? "ok" : "degraded", database: db ? "ok" : "unreachable", time: nowIso() };
  if (!detailed) return base;
  const settings = await getSettings(env);
  return { ...base, processing: await processingStats(env), emailConfigured: emailConfigured(env), turnstileConfigured: !!env.TURNSTILE_SECRET_KEY, queueBound: !!env.NOTIFY_QUEUE, maxIpaBytes: settings.maxIpaBytes, environment: env.ENVIRONMENT ?? "unknown" };
}

export async function portalDownloads(env: AppEnv, actor: Actor) {
  return all(env.DB, `SELECT d.id, d.event_type, d.created_at, b.version, b.build_number, b.app_name, p.name AS project_name
    FROM downloads d JOIN builds b ON b.id = d.build_id JOIN projects p ON p.id = b.project_id
    WHERE d.user_id = ? AND d.event_type IN ('manifest_requested','download_started','install_confirmed') ORDER BY d.created_at DESC LIMIT 50`, actor.userId);
}
