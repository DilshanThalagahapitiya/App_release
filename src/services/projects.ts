import type { AppEnv } from "@/lib/env";
import type { Actor } from "@/lib/auth";
import { all, one, run, likeTerm, type Page } from "@/lib/db";
import { ApiError, forbidden, notFound } from "@/lib/errors";
import { newId } from "@/lib/crypto";
import { nowIso } from "@/lib/time";
import { slugify } from "@/lib/rules";
import { audit } from "@/lib/audit";
import { accessibleProjects, activeOrgRole, loadProject, orgIdsForActor, placeholders, requireOrgAdmin } from "@/lib/access";
import { can, type EffectiveRole, type ProjectRole } from "@/lib/permissions";
import type { ProjectRow } from "@/lib/types";

export function projectDto(p: ProjectRow, role?: EffectiveRole) {
  const { icon_r2_key: _icon, ...rest } = p;
  void _icon;
  return { ...rest, has_icon: !!p.icon_r2_key, my_role: role };
}

const SORTS: Record<string, string> = { updated: "p.updated_at DESC", name: "p.name COLLATE NOCASE ASC", created: "p.created_at DESC" };

export async function listProjects(env: AppEnv, actor: Actor, q: { page: number; pageSize: number; q?: string; status?: string; sort?: string; organisationId?: string }): Promise<Page<unknown>> {
  const accessible = await accessibleProjects(env, actor, { organisationId: q.organisationId });
  const empty = { items: [], page: q.page, pageSize: q.pageSize, total: 0 };
  if (!accessible.length) return empty;
  const ids = accessible.map((a) => a.id);
  const roleMap = new Map(accessible.map((a) => [a.id, a.role]));
  const where = [`p.id IN (${placeholders(ids.length)})`]; const params: unknown[] = [...ids];
  if (q.status) { where.push("p.status = ?"); params.push(q.status); }
  if (q.q) { where.push("(p.name LIKE ? ESCAPE '\\' OR p.app_display_name LIKE ? ESCAPE '\\' OR p.expected_bundle_identifier LIKE ? ESCAPE '\\')"); const t = likeTerm(q.q); params.push(t, t, t); }
  const W = where.join(" AND ");
  const total = (await one<{ n: number }>(env.DB, `SELECT COUNT(*) AS n FROM projects p WHERE ${W}`, ...params))?.n ?? 0;
  const rows = await all<ProjectRow & { member_count: number; latest_version: string | null; latest_build_at: string | null; build_count: number }>(
    env.DB,
    `SELECT p.*,
       (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id AND pm.status = 'active') AS member_count,
       (SELECT COUNT(*) FROM builds b WHERE b.project_id = p.id AND b.deleted_at IS NULL) AS build_count,
       (SELECT COALESCE(b.version,'?') || ' (' || COALESCE(b.build_number,'?') || ')' FROM builds b WHERE b.project_id = p.id AND b.deleted_at IS NULL ORDER BY b.created_at DESC LIMIT 1) AS latest_version,
       (SELECT b.created_at FROM builds b WHERE b.project_id = p.id AND b.deleted_at IS NULL ORDER BY b.created_at DESC LIMIT 1) AS latest_build_at
     FROM projects p WHERE ${W} ORDER BY ${SORTS[q.sort ?? "updated"] ?? SORTS.updated} LIMIT ? OFFSET ?`,
    ...params, q.pageSize, (q.page - 1) * q.pageSize);
  return { items: rows.map((r) => ({ ...projectDto(r, roleMap.get(r.id)), member_count: r.member_count, build_count: r.build_count, latest_version: r.latest_version, latest_build_at: r.latest_build_at })), page: q.page, pageSize: q.pageSize, total };
}

export async function createProject(env: AppEnv, actor: Actor, input: Record<string, unknown> & { name: string; organisationId?: string }, req?: Request) {
  let orgId = input.organisationId;
  if (!orgId) {
    const ids = await orgIdsForActor(env, actor);
    if (ids.length !== 1) throw new ApiError("VALIDATION_ERROR", "organisationId is required.");
    orgId = ids[0];
  }
  await requireOrgAdmin(env, actor, orgId);
  const org = await one<{ status: string }>(env.DB, "SELECT status FROM organisations WHERE id = ?", orgId);
  if (org?.status !== "active") throw new ApiError("INVALID_STATE", "The organisation is not active.");
  let slug = slugify(input.name);
  if (await one(env.DB, "SELECT id FROM projects WHERE organisation_id = ? AND slug = ?", orgId, slug)) slug = `${slug}-${newId().slice(0, 6)}`;
  const id = newId(); const now = nowIso();
  await run(env.DB,
    `INSERT INTO projects (id, organisation_id, name, slug, description, app_display_name, expected_bundle_identifier, default_qa_instructions, default_install_instructions, access_policy, feedback_enabled, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, orgId, input.name, slug, input.description ?? null, input.app_display_name ?? null, input.expected_bundle_identifier ?? null,
    input.default_qa_instructions ?? null, input.default_install_instructions ?? null, input.access_policy ?? "named_users_only", input.feedback_enabled === false ? 0 : 1, actor.userId, now, now);
  await audit(env, { organisationId: orgId, actorUserId: actor.userId, action: "project.created", resourceType: "project", resourceId: id, metadata: { name: input.name }, req });
  return projectDto((await one<ProjectRow>(env.DB, "SELECT * FROM projects WHERE id = ?", id))!, "org_admin");
}

export async function getProject(env: AppEnv, actor: Actor, projectId: string) {
  const { project, role } = await loadProject(env, actor, projectId);
  const stats = await one<{ builds: number; published: number; members: number; open_feedback: number }>(env.DB,
    `SELECT (SELECT COUNT(*) FROM builds WHERE project_id = ?1 AND deleted_at IS NULL) AS builds,
            (SELECT COUNT(*) FROM builds WHERE project_id = ?1 AND deleted_at IS NULL AND publish_status = 'published') AS published,
            (SELECT COUNT(*) FROM project_members WHERE project_id = ?1 AND status = 'active') AS members,
            (SELECT COUNT(*) FROM feedback WHERE project_id = ?1 AND status NOT IN ('resolved','closed')) AS open_feedback`, projectId);
  return { ...projectDto(project, role), stats };
}

export async function updateProject(env: AppEnv, actor: Actor, projectId: string, patch: Record<string, unknown>, req?: Request) {
  const { project } = await loadProject(env, actor, projectId, "project:update");
  const cols = ["name", "description", "app_display_name", "expected_bundle_identifier", "default_qa_instructions", "default_install_instructions", "access_policy", "status"];
  const sets: string[] = []; const vals: unknown[] = [];
  for (const k of cols) if (k in patch && patch[k] !== undefined) { sets.push(`${k} = ?`); vals.push(patch[k]); }
  if ("feedback_enabled" in patch && patch.feedback_enabled !== undefined) { sets.push("feedback_enabled = ?"); vals.push(patch.feedback_enabled ? 1 : 0); }
  if (sets.length) await run(env.DB, `UPDATE projects SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`, ...vals, nowIso(), projectId);
  await audit(env, { organisationId: project.organisation_id, actorUserId: actor.userId, action: "project.updated", resourceType: "project", resourceId: projectId, metadata: { fields: Object.keys(patch) }, req });
  return getProject(env, actor, projectId);
}

/** "Delete" archives the project and unpublishes its builds and revokes its links; data is purged later by retention policy. */
export async function deleteProject(env: AppEnv, actor: Actor, projectId: string, req?: Request) {
  const { project } = await loadProject(env, actor, projectId, "project:delete");
  const now = nowIso();
  await run(env.DB, "UPDATE projects SET status = 'archived', updated_at = ? WHERE id = ?", now, projectId);
  await run(env.DB, "UPDATE distribution_links SET status = 'revoked', revoked_at = ? WHERE project_id = ? AND status != 'revoked'", now, projectId);
  await run(env.DB, "UPDATE builds SET publish_status = CASE WHEN publish_status = 'published' THEN 'unpublished' ELSE publish_status END, updated_at = ? WHERE project_id = ?", now, projectId);
  await audit(env, { organisationId: project.organisation_id, actorUserId: actor.userId, action: "project.archived", resourceType: "project", resourceId: projectId, req });
  return { id: projectId, archived: true };
}

export async function listProjectMembers(env: AppEnv, actor: Actor, projectId: string) {
  const { role } = await loadProject(env, actor, projectId);
  if (!can(role, "build:view_internal")) throw forbidden();
  return all(env.DB,
    `SELECT pm.id, pm.role, pm.status, pm.created_at, u.id AS user_id, u.email, u.display_name
       FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id = ? AND pm.status = 'active' ORDER BY u.display_name`, projectId);
}

export async function addProjectMember(env: AppEnv, actor: Actor, projectId: string, input: { userId: string; role: ProjectRole }, req?: Request) {
  const { project } = await loadProject(env, actor, projectId, "project:members:manage");
  // The user must already be an active member of the SAME organisation (isolation).
  const orgRole = await one<{ role: string }>(env.DB, "SELECT role FROM organisation_members WHERE organisation_id = ? AND user_id = ? AND status = 'active'", project.organisation_id, input.userId);
  if (!orgRole) throw new ApiError("VALIDATION_ERROR", "The user is not an active member of this organisation.");
  if (input.role === "project_admin" && !actor.isPlatformOwner && (await activeOrgRole(env, actor, project.organisation_id)) !== "org_admin")
    throw forbidden("Only organisation admins can grant the project admin role.");
  const id = newId();
  await run(env.DB, `INSERT INTO project_members (id, project_id, user_id, role, status, added_by, created_at) VALUES (?,?,?,?, 'active', ?, ?)
    ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role, status = 'active'`, id, projectId, input.userId, input.role, actor.userId, nowIso());
  await audit(env, { organisationId: project.organisation_id, actorUserId: actor.userId, action: "project.member_added", resourceType: "project", resourceId: projectId, metadata: { userId: input.userId, role: input.role }, req });
  return { projectId, userId: input.userId, role: input.role };
}

export async function removeProjectMember(env: AppEnv, actor: Actor, projectId: string, memberId: string, req?: Request) {
  const { project } = await loadProject(env, actor, projectId, "project:members:manage");
  const m = await one<{ id: string; user_id: string }>(env.DB, "SELECT id, user_id FROM project_members WHERE id = ? AND project_id = ?", memberId, projectId);
  if (!m) throw notFound("Member");
  await run(env.DB, "UPDATE project_members SET status = 'removed' WHERE id = ?", memberId);
  // Named-user links the removed member held are no longer usable because access re-checks project membership.
  await audit(env, { organisationId: project.organisation_id, actorUserId: actor.userId, action: "project.member_removed", resourceType: "project", resourceId: projectId, metadata: { userId: m.user_id }, req });
  return { id: memberId, removed: true };
}
