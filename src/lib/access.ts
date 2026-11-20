import type { AppEnv } from "./env";
import type { Actor } from "./auth";
import { all, one } from "./db";
import { ApiError, forbidden, notFound } from "./errors";
import { can, effectiveProjectRole, type Action, type EffectiveRole, type OrgRole, type ProjectRole } from "./permissions";
import type { BuildRow, FeedbackRow, ProjectRow } from "./types";

/**
 * Central authorisation. EVERY query that returns tenant data goes through these loaders,
 * which scope by organisation membership and project membership. Unauthorised callers get
 * NOT_FOUND (not FORBIDDEN) for resources they cannot see, so ids cannot be probed (anti-IDOR).
 */

export async function activeOrgRole(env: AppEnv, actor: Actor, organisationId: string): Promise<OrgRole | null> {
  const r = await one<{ role: OrgRole }>(
    env.DB,
    `SELECT m.role FROM organisation_members m JOIN organisations o ON o.id = m.organisation_id
      WHERE m.organisation_id = ? AND m.user_id = ? AND m.status = 'active' AND o.status = 'active'`,
    organisationId, actor.userId,
  );
  return r?.role ?? null;
}

export async function requireOrgAdmin(env: AppEnv, actor: Actor, organisationId: string): Promise<void> {
  if (actor.isPlatformOwner) {
    if (!(await one(env.DB, "SELECT id FROM organisations WHERE id = ?", organisationId))) throw notFound("Organisation");
    return;
  }
  const role = await activeOrgRole(env, actor, organisationId);
  if (!role) throw notFound("Organisation");
  if (role !== "org_admin") throw forbidden();
}

export async function requireOrgMember(env: AppEnv, actor: Actor, organisationId: string): Promise<OrgRole | "owner"> {
  if (actor.isPlatformOwner) return "owner";
  const role = await activeOrgRole(env, actor, organisationId);
  if (!role) throw notFound("Organisation");
  return role;
}

export interface ProjectAccess {
  project: ProjectRow;
  role: EffectiveRole;
}

export async function projectRoleFor(env: AppEnv, actor: Actor, project: ProjectRow): Promise<EffectiveRole | null> {
  const orgRole = actor.isPlatformOwner ? null : await activeOrgRole(env, actor, project.organisation_id);
  let projectRole: ProjectRole | null = null;
  if (!actor.isPlatformOwner && orgRole && orgRole !== "org_admin") {
    projectRole = (await one<{ role: ProjectRole }>(env.DB, "SELECT role FROM project_members WHERE project_id = ? AND user_id = ? AND status = 'active'", project.id, actor.userId))?.role ?? null;
  }
  return effectiveProjectRole({ isPlatformOwner: actor.isPlatformOwner, orgRole, projectRole });
}

export async function loadProject(env: AppEnv, actor: Actor, projectId: string, action: Action = "project:view"): Promise<ProjectAccess> {
  const project = await one<ProjectRow>(env.DB, "SELECT * FROM projects WHERE id = ?", projectId);
  if (!project) throw notFound("Project");
  const role = await projectRoleFor(env, actor, project);
  if (!role) throw notFound("Project");
  if (!can(role, action)) throw forbidden();
  return { project, role };
}

export interface BuildAccess extends ProjectAccess {
  build: BuildRow;
}

export async function loadBuild(env: AppEnv, actor: Actor, buildId: string, action: Action = "build:view"): Promise<BuildAccess> {
  const build = await one<BuildRow>(env.DB, "SELECT * FROM builds WHERE id = ? AND deleted_at IS NULL", buildId);
  if (!build) throw notFound("Build");
  const { project, role } = await loadProject(env, actor, build.project_id, "project:view").catch((e) => {
    if (e instanceof ApiError && e.code === "FORBIDDEN") throw notFound("Build");
    throw e;
  });
  if (!can(role, action)) throw forbidden();
  // Non-staff roles only ever see published builds.
  if (!can(role, "build:view_internal") && build.publish_status !== "published") throw notFound("Build");
  return { build, project, role };
}

export async function loadFeedback(env: AppEnv, actor: Actor, feedbackId: string): Promise<{ feedback: FeedbackRow; project: ProjectRow; role: EffectiveRole }> {
  const feedback = await one<FeedbackRow>(env.DB, "SELECT * FROM feedback WHERE id = ?", feedbackId);
  if (!feedback) throw notFound("Feedback");
  const { project, role } = await loadProject(env, actor, feedback.project_id, "project:view");
  if (!can(role, "feedback:view_all")) {
    if (!can(role, "feedback:view_own") || feedback.reporter_user_id !== actor.userId) throw notFound("Feedback");
  }
  return { feedback, project, role };
}

/** All project ids the actor may see (for list endpoints). Platform owner: every project. */
export async function accessibleProjects(env: AppEnv, actor: Actor, opts: { organisationId?: string } = {}): Promise<{ id: string; role: EffectiveRole }[]> {
  const orgFilter = opts.organisationId ? " AND p.organisation_id = ?" : "";
  const extra = opts.organisationId ? [opts.organisationId] : [];
  if (actor.isPlatformOwner) {
    return (await all<{ id: string }>(env.DB, `SELECT p.id FROM projects p WHERE 1=1${orgFilter}`, ...extra)).map((r) => ({ id: r.id, role: "owner" as const }));
  }
  const admin = await all<{ id: string }>(
    env.DB,
    `SELECT p.id FROM projects p JOIN organisation_members m ON m.organisation_id = p.organisation_id
       JOIN organisations o ON o.id = p.organisation_id
      WHERE m.user_id = ? AND m.status = 'active' AND m.role = 'org_admin' AND o.status = 'active'${orgFilter}`,
    actor.userId, ...extra,
  );
  const member = await all<{ id: string; role: ProjectRole }>(
    env.DB,
    `SELECT p.id, pm.role FROM projects p
       JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ? AND pm.status = 'active'
       JOIN organisation_members m ON m.organisation_id = p.organisation_id AND m.user_id = pm.user_id AND m.status = 'active'
       JOIN organisations o ON o.id = p.organisation_id AND o.status = 'active'
      WHERE 1=1${orgFilter}`,
    actor.userId, ...extra,
  );
  const map = new Map<string, EffectiveRole>();
  for (const m of member) map.set(m.id, m.role);
  for (const a of admin) map.set(a.id, "org_admin");
  return [...map].map(([id, role]) => ({ id, role }));
}

export const placeholders = (n: number) => Array(n).fill("?").join(",");

export async function orgIdsForActor(env: AppEnv, actor: Actor): Promise<string[]> {
  if (actor.isPlatformOwner) return (await all<{ id: string }>(env.DB, "SELECT id FROM organisations")).map((r) => r.id);
  return (await all<{ organisation_id: string }>(env.DB, "SELECT organisation_id FROM organisation_members WHERE user_id = ? AND status = 'active'", actor.userId)).map((r) => r.organisation_id);
}
