import type { AppEnv } from "./env";
import { all, one, run } from "./db";
import { newId } from "./crypto";
import { nowIso } from "./time";
import { queueEmail } from "./email";
import { placeholders } from "./access";

export const NOTIFICATION_TYPES = [
  "invitation_received", "build_uploaded", "validation_completed", "validation_failed", "build_published",
  "feedback_received", "feedback_status_changed", "feedback_reply", "link_expiring", "link_revoked",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotifyInput {
  userIds: string[];
  organisationId?: string | null;
  type: NotificationType;
  title: string;
  body?: string;
  resourceType?: string;
  resourceId?: string;
  /** In-app path to link to. */
  path?: string;
}

/** Create in-app notifications (honouring preferences) and queue email only where a provider exists. */
export async function notify(env: AppEnv, n: NotifyInput): Promise<void> {
  const ids = [...new Set(n.userIds)];
  if (!ids.length) return;
  const users = await all<{ id: string; email: string; status: string }>(env.DB, `SELECT id, email, status FROM users WHERE id IN (${placeholders(ids.length)})`, ...ids);
  const prefs = await all<{ user_id: string; in_app_enabled: number; email_enabled: number }>(
    env.DB, `SELECT user_id, in_app_enabled, email_enabled FROM notification_preferences WHERE event_type = ? AND user_id IN (${placeholders(ids.length)})`, n.type, ...ids);
  const prefMap = new Map(prefs.map((p) => [p.user_id, p]));
  for (const u of users) {
    if (u.status !== "active") continue;
    const p = prefMap.get(u.id);
    const inApp = p ? !!p.in_app_enabled : true;
    const wantsEmail = p ? !!p.email_enabled : true;
    if (!inApp && !wantsEmail) continue;
    const notificationId = newId();
    let emailState: "not_requested" | "not_configured" | "queued" = "not_requested";
    if (wantsEmail) {
      emailState = await queueEmail(env, {
        to: u.email, subject: n.title, template: n.type, notificationId,
        text: `${n.title}\n\n${n.body ?? ""}\n\n${n.path ? env.APP_URL + n.path : env.APP_URL}`,
      });
    }
    if (inApp) {
      await run(env.DB, "INSERT INTO notifications (id, user_id, organisation_id, type, title, body, resource_type, resource_id, email_state, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        notificationId, u.id, n.organisationId ?? null, n.type, n.title, n.body ?? null, n.resourceType ?? null, n.resourceId ?? null, emailState, nowIso());
    }
  }
}

/** Staff of a project: org admins + project admins + QA managers (active). */
export async function projectStaffIds(env: AppEnv, projectId: string, organisationId: string): Promise<string[]> {
  const rows = await all<{ user_id: string }>(
    env.DB,
    `SELECT user_id FROM organisation_members WHERE organisation_id = ? AND status = 'active' AND role = 'org_admin'
     UNION
     SELECT pm.user_id FROM project_members pm JOIN organisation_members om ON om.user_id = pm.user_id AND om.organisation_id = ? AND om.status = 'active'
      WHERE pm.project_id = ? AND pm.status = 'active' AND pm.role IN ('project_admin','qa_manager')`,
    organisationId, organisationId, projectId,
  );
  return rows.map((r) => r.user_id);
}

export async function projectMemberIds(env: AppEnv, projectId: string): Promise<string[]> {
  return (await all<{ user_id: string }>(env.DB, "SELECT user_id FROM project_members WHERE project_id = ? AND status = 'active'", projectId)).map((r) => r.user_id);
}

export async function userExists(env: AppEnv, id: string) {
  return !!(await one(env.DB, "SELECT id FROM users WHERE id = ?", id));
}
