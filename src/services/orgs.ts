import type { AppEnv } from "@/lib/env";
import type { Actor } from "@/lib/auth";
import { all, one, run, stmt, batch, parseJson } from "@/lib/db";
import { ApiError, forbidden, notFound } from "@/lib/errors";
import { hashPassword, hashToken, newId, randomToken } from "@/lib/crypto";
import { addDays, nowIso } from "@/lib/time";
import { slugify } from "@/lib/rules";
import { audit } from "@/lib/audit";
import { queueEmail } from "@/lib/email";
import { notify } from "@/lib/notify";
import { orgIdsForActor, placeholders, requireOrgAdmin } from "@/lib/access";
import { revokeAllSessions, createSession } from "@/lib/auth";
import type { OrgRole } from "@/lib/permissions";

export interface OrgDto {
  id: string; name: string; slug: string; timezone: string; status: string; logo_r2_key?: never;
  default_link_expiry_days: number; default_qa_instructions: string | null; created_at: string; updated_at: string;
}
const ORG_COLS = "id, name, slug, timezone, status, default_link_expiry_days, default_qa_instructions, created_at, updated_at";

export async function listOrganisations(env: AppEnv, actor: Actor) {
  const ids = await orgIdsForActor(env, actor);
  if (!ids.length) return [];
  return all<OrgDto & { my_role?: string }>(env.DB, `SELECT ${ORG_COLS} FROM organisations WHERE id IN (${placeholders(ids.length)}) ORDER BY name`, ...ids);
}

export async function getOrganisation(env: AppEnv, actor: Actor, id: string) {
  if (!(await orgIdsForActor(env, actor)).includes(id)) throw notFound("Organisation");
  const org = await one<OrgDto>(env.DB, `SELECT ${ORG_COLS} FROM organisations WHERE id = ?`, id);
  if (!org) throw notFound("Organisation");
  return org;
}

export async function createOrganisation(env: AppEnv, actor: Actor, input: { name: string; slug?: string; adminEmail?: string; timezone: string }, req?: Request) {
  if (!actor.isPlatformOwner) throw forbidden("Only the Platform Owner can create organisations.");
  const slug = input.slug ?? slugify(input.name);
  if (await one(env.DB, "SELECT id FROM organisations WHERE slug = ?", slug)) throw new ApiError("CONFLICT", "An organisation with this slug already exists.");
  const id = newId(); const now = nowIso();
  await run(env.DB, "INSERT INTO organisations (id, name, slug, timezone, status, created_at, updated_at) VALUES (?,?,?,?, 'active', ?, ?)", id, input.name, slug, input.timezone, now, now);
  await audit(env, { organisationId: id, actorUserId: actor.userId, action: "organisation.created", resourceType: "organisation", resourceId: id, metadata: { name: input.name }, req });
  let invite: Awaited<ReturnType<typeof inviteMember>> | null = null;
  if (input.adminEmail) invite = await inviteMember(env, actor, id, { email: input.adminEmail, role: "org_admin", projectIds: [] }, req);
  return { id, name: input.name, slug, invitation: invite };
}

export async function updateOrganisation(env: AppEnv, actor: Actor, id: string, patch: Record<string, unknown>, req?: Request) {
  await requireOrgAdmin(env, actor, id);
  if (patch.status !== undefined && !actor.isPlatformOwner) throw forbidden("Only the Platform Owner can change organisation status.");
  const allowed = ["name", "timezone", "default_link_expiry_days", "default_qa_instructions", "status"];
  const sets: string[] = []; const vals: unknown[] = [];
  for (const k of allowed) if (k in patch && patch[k] !== undefined) { sets.push(`${k} = ?`); vals.push(patch[k]); }
  if (sets.length) await run(env.DB, `UPDATE organisations SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`, ...vals, nowIso(), id);
  await audit(env, { organisationId: id, actorUserId: actor.userId, action: "organisation.updated", resourceType: "organisation", resourceId: id, metadata: { fields: Object.keys(patch) }, req });
  return getOrganisation(env, actor, id);
}

export async function listMembers(env: AppEnv, actor: Actor, organisationId: string) {
  await requireOrgAdmin(env, actor, organisationId);
  const members = await all(env.DB,
    `SELECT m.id, m.role, m.status, m.joined_at, m.created_at, u.id AS user_id, u.email, u.display_name, u.last_login_at, u.status AS user_status
       FROM organisation_members m JOIN users u ON u.id = m.user_id WHERE m.organisation_id = ? ORDER BY u.display_name`, organisationId);
  const invitations = await all(env.DB,
    `SELECT id, email, role, project_id, expires_at, accepted_at, revoked_at, created_at FROM invitations
      WHERE organisation_id = ? AND accepted_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC`, organisationId);
  return { members, invitations };
}

export async function inviteMember(
  env: AppEnv, actor: Actor, organisationId: string,
  input: { email: string; role: OrgRole; projectIds: string[]; projectRole?: string }, req?: Request,
) {
  await requireOrgAdmin(env, actor, organisationId);
  const email = input.email.toLowerCase();
  const existing = await one(env.DB, "SELECT m.id FROM organisation_members m JOIN users u ON u.id = m.user_id WHERE m.organisation_id = ? AND u.email = ? AND m.status = 'active'", organisationId, email);
  if (existing) throw new ApiError("CONFLICT", "This person is already a member of the organisation.");
  if (input.projectIds.length) {
    const found = await all<{ id: string }>(env.DB, `SELECT id FROM projects WHERE organisation_id = ? AND id IN (${placeholders(input.projectIds.length)})`, organisationId, ...input.projectIds);
    if (found.length !== new Set(input.projectIds).size) throw new ApiError("VALIDATION_ERROR", "One or more projects do not belong to this organisation.");
  }
  // Revoke older pending invitations for the same email so only one token is live.
  await run(env.DB, "UPDATE invitations SET revoked_at = ? WHERE organisation_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL", nowIso(), organisationId, email);
  const token = randomToken(32);
  const id = newId();
  await run(env.DB, "INSERT INTO invitations (id, organisation_id, project_id, project_ids_json, project_role, email, role, token_hash, invited_by, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    id, organisationId, input.projectIds[0] ?? null, JSON.stringify(input.projectIds), input.projectRole ?? (input.role === "org_admin" ? null : input.role === "project_admin" ? "project_admin" : input.role),
    email, input.role, await hashToken(token), actor.userId, addDays(7), nowIso());
  const inviteUrl = `${env.APP_URL}/invitations/accept?token=${token}`;
  const org = await one<{ name: string }>(env.DB, "SELECT name FROM organisations WHERE id = ?", organisationId);
  const delivery = await queueEmail(env, { to: email, template: "invitation", subject: `You're invited to ${org?.name ?? "an organisation"}`, text: `You have been invited to join ${org?.name}.\n\nAccept the invitation (valid 7 days, single use):\n${inviteUrl}` });
  const existingUser = await one<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = ?", email);
  if (existingUser) await notify(env, { userIds: [existingUser.id], organisationId, type: "invitation_received", title: `Invitation to ${org?.name}`, path: "/invitations/accept" });
  await audit(env, { organisationId, actorUserId: actor.userId, action: "member.invited", resourceType: "invitation", resourceId: id, metadata: { email, role: input.role }, req });
  // The raw link is returned ONCE to the inviting admin so it can be shared manually when email is not configured.
  return { id, email, role: input.role, expiresAt: addDays(7), inviteUrl, emailDelivery: delivery };
}

async function loadInvitationForAdmin(env: AppEnv, actor: Actor, invitationId: string) {
  const inv = await one<{ id: string; organisation_id: string; email: string; role: OrgRole; project_ids_json: string | null; project_role: string | null; accepted_at: string | null; revoked_at: string | null }>(
    env.DB, "SELECT * FROM invitations WHERE id = ?", invitationId);
  if (!inv) throw notFound("Invitation");
  await requireOrgAdmin(env, actor, inv.organisation_id);
  return inv;
}

export async function resendInvitation(env: AppEnv, actor: Actor, invitationId: string, req?: Request) {
  const inv = await loadInvitationForAdmin(env, actor, invitationId);
  if (inv.accepted_at || inv.revoked_at) throw new ApiError("INVALID_STATE", "This invitation is no longer pending.");
  await run(env.DB, "UPDATE invitations SET revoked_at = ? WHERE id = ?", nowIso(), inv.id);
  return inviteMember(env, actor, inv.organisation_id, { email: inv.email, role: inv.role, projectIds: parseJson<string[]>(inv.project_ids_json, []), projectRole: inv.project_role ?? undefined }, req);
}

export async function revokeInvitation(env: AppEnv, actor: Actor, invitationId: string, req?: Request) {
  const inv = await loadInvitationForAdmin(env, actor, invitationId);
  if (inv.accepted_at) throw new ApiError("INVALID_STATE", "This invitation was already accepted.");
  await run(env.DB, "UPDATE invitations SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?", nowIso(), inv.id);
  await audit(env, { organisationId: inv.organisation_id, actorUserId: actor.userId, action: "invitation.revoked", resourceType: "invitation", resourceId: inv.id, req });
  return { id: inv.id, revoked: true };
}

/** Invitation acceptance is one-time: the UPDATE ... WHERE accepted_at IS NULL claim makes concurrent replays fail. */
export async function acceptInvitation(env: AppEnv, req: Request, input: { token: string; displayName?: string; password?: string }, actor: Actor | null) {
  const hash = await hashToken(input.token);
  const inv = await one<{ id: string; organisation_id: string; email: string; role: OrgRole; project_ids_json: string | null; project_role: string | null; invited_by: string | null }>(
    env.DB, "SELECT * FROM invitations WHERE token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?", hash, nowIso());
  if (!inv) throw new ApiError("INVALID_STATE", "This invitation is invalid, expired or already used.");
  let user = await one<{ id: string; password_hash: string | null; status: string }>(env.DB, "SELECT id, password_hash, status FROM users WHERE email = ?", inv.email);
  const now = nowIso();
  let created = false;
  if (!user) {
    if (!input.password || !input.displayName) throw new ApiError("VALIDATION_ERROR", "Display name and a password are required to create your account.");
    const id = newId();
    await run(env.DB, "INSERT INTO users (id, email, display_name, password_hash, email_verified_at, status, created_at, updated_at) VALUES (?,?,?,?,?, 'active', ?, ?)",
      id, inv.email, input.displayName, await hashPassword(input.password), now, now, now);
    user = { id, password_hash: "x", status: "active" }; created = true;
  } else if (user.status === "disabled") {
    throw new ApiError("FORBIDDEN", "This account is disabled.");
  } else if (user.status === "invited" && input.password) {
    await run(env.DB, "UPDATE users SET password_hash = ?, display_name = COALESCE(?, display_name), status = 'active', email_verified_at = ?, updated_at = ? WHERE id = ?", await hashPassword(input.password), input.displayName ?? null, now, now, user.id);
  }
  // Claim the invitation atomically (single use).
  const claimed = await one(env.DB, "UPDATE invitations SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id", now, inv.id);
  if (!claimed) throw new ApiError("INVALID_STATE", "This invitation is invalid, expired or already used.");
  const stmts = [
    stmt(env.DB, `INSERT INTO organisation_members (id, organisation_id, user_id, role, status, invited_by, joined_at, created_at) VALUES (?,?,?,?, 'active', ?, ?, ?)
                  ON CONFLICT(organisation_id, user_id) DO UPDATE SET role = excluded.role, status = 'active', joined_at = excluded.joined_at`,
      newId(), inv.organisation_id, user.id, inv.role, inv.invited_by, now, now),
  ];
  const projectRole = inv.project_role ?? (inv.role === "org_admin" ? "project_admin" : inv.role);
  if (inv.role !== "org_admin") {
    for (const pid of parseJson<string[]>(inv.project_ids_json, [])) {
      stmts.push(stmt(env.DB, `INSERT INTO project_members (id, project_id, user_id, role, status, added_by, created_at)
        SELECT ?, p.id, ?, ?, 'active', ?, ? FROM projects p WHERE p.id = ? AND p.organisation_id = ?
        ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role, status = 'active'`,
        newId(), user.id, projectRole, inv.invited_by, now, pid, inv.organisation_id));
    }
  }
  await batch(env.DB, stmts);
  await audit(env, { organisationId: inv.organisation_id, actorUserId: user.id, action: "invitation.accepted", resourceType: "invitation", resourceId: inv.id, metadata: { newAccount: created }, req });
  // Only a freshly created account (password just chosen) is signed in; existing accounts must authenticate normally.
  const session = created || (actor && actor.userId === user.id) ? await createSession(env, user.id) : null;
  return { organisationId: inv.organisation_id, accountCreated: created, session };
}

export async function updateMember(env: AppEnv, actor: Actor, organisationId: string, memberId: string, patch: { role?: OrgRole; status?: "active" | "deactivated" }, req?: Request) {
  await requireOrgAdmin(env, actor, organisationId);
  const m = await one<{ id: string; user_id: string; role: string; status: string }>(env.DB, "SELECT id, user_id, role, status FROM organisation_members WHERE id = ? AND organisation_id = ?", memberId, organisationId);
  if (!m) throw notFound("Member");
  if (m.user_id === actor.userId) throw new ApiError("INVALID_STATE", "You cannot change your own membership.");
  if (m.role === "org_admin" && (patch.role && patch.role !== "org_admin" || patch.status === "deactivated")) {
    const admins = await one<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM organisation_members WHERE organisation_id = ? AND role = 'org_admin' AND status = 'active'", organisationId);
    if ((admins?.n ?? 0) <= 1) throw new ApiError("INVALID_STATE", "The organisation must keep at least one active administrator.");
  }
  await run(env.DB, "UPDATE organisation_members SET role = COALESCE(?, role), status = COALESCE(?, status) WHERE id = ?", patch.role ?? null, patch.status ?? null, memberId);
  if (patch.status === "deactivated") await revokeAllSessionsIfNoActiveMembership(env, m.user_id);
  await audit(env, { organisationId, actorUserId: actor.userId, action: patch.status === "deactivated" ? "member.deactivated" : patch.status === "active" ? "member.reactivated" : "member.role_changed", resourceType: "member", resourceId: memberId, metadata: patch, req });
  return { id: memberId, ...patch };
}

async function revokeAllSessionsIfNoActiveMembership(env: AppEnv, userId: string) {
  // A deactivated member loses access immediately; sessions are revoked only if they have no other active org.
  const other = await one(env.DB, "SELECT id FROM organisation_members WHERE user_id = ? AND status = 'active'", userId);
  if (!other) await revokeAllSessions(env, userId);
}

export async function removeMember(env: AppEnv, actor: Actor, organisationId: string, memberId: string, req?: Request) {
  await requireOrgAdmin(env, actor, organisationId);
  const m = await one<{ user_id: string; role: string }>(env.DB, "SELECT user_id, role FROM organisation_members WHERE id = ? AND organisation_id = ?", memberId, organisationId);
  if (!m) throw notFound("Member");
  if (m.user_id === actor.userId) throw new ApiError("INVALID_STATE", "You cannot remove yourself.");
  if (m.role === "org_admin") {
    const admins = await one<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM organisation_members WHERE organisation_id = ? AND role = 'org_admin' AND status = 'active'", organisationId);
    if ((admins?.n ?? 0) <= 1) throw new ApiError("INVALID_STATE", "The organisation must keep at least one active administrator.");
  }
  await batch(env.DB, [
    stmt(env.DB, "UPDATE project_members SET status = 'removed' WHERE user_id = ? AND project_id IN (SELECT id FROM projects WHERE organisation_id = ?)", m.user_id, organisationId),
    stmt(env.DB, "DELETE FROM organisation_members WHERE id = ?", memberId),
  ]);
  await revokeAllSessionsIfNoActiveMembership(env, m.user_id);
  await audit(env, { organisationId, actorUserId: actor.userId, action: "member.removed", resourceType: "member", resourceId: memberId, req });
  return { id: memberId, removed: true };
}

/** Idempotently create the first Platform Owner from environment secrets (called by the login page / setup route). */
export async function bootstrapOwner(env: AppEnv): Promise<boolean> {
  if (!env.BOOTSTRAP_OWNER_EMAIL || !env.BOOTSTRAP_OWNER_PASSWORD) return false;
  const any = await one(env.DB, "SELECT id FROM users WHERE is_platform_owner = 1 LIMIT 1");
  if (any) return false;
  const now = nowIso();
  await run(env.DB, "INSERT INTO users (id, email, display_name, password_hash, email_verified_at, is_platform_owner, status, created_at, updated_at) VALUES (?,?,?,?,?,1,'active',?,?) ON CONFLICT(email) DO NOTHING",
    newId(), env.BOOTSTRAP_OWNER_EMAIL.toLowerCase(), "Platform Owner", await hashPassword(env.BOOTSTRAP_OWNER_PASSWORD), now, now, now);
  await audit(env, { actorType: "system", action: "platform.owner_bootstrapped" });
  return true;
}
