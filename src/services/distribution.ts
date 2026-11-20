import type { AppEnv } from "@/lib/env";
import type { Actor } from "@/lib/auth";
import { actorFromRequest, parseCookies } from "@/lib/auth";
import { all, one, run, stmt, batch, parseJson } from "@/lib/db";
import { ApiError, forbidden, notFound } from "@/lib/errors";
import { hashPassword, hashToken, newId, toBase64Url, verifyPassword } from "@/lib/crypto";
import { addDays, nowIso } from "@/lib/time";
import { buildManifest, linkState, summariseUserAgent, type LinkState } from "@/lib/rules";
import { decideInstallAction, type InstallAction } from "@/lib/eligibility";
import { audit } from "@/lib/audit";
import { ipHash } from "@/lib/ratelimit";
import { loadBuild, loadProject, projectRoleFor } from "@/lib/access";
import { can } from "@/lib/permissions";
import { notify, projectStaffIds } from "@/lib/notify";
import { signAccessGrant, signedFileUrl, verifyAccessGrant } from "@/lib/storage";
import type { BuildRow, LinkRow, ProjectRow } from "@/lib/types";
import { getSettings } from "@/lib/settings";

/**
 * The public token is derived (HMAC) from the link id and the server secret, so an authorised admin can
 * re-display the link/QR later while the database only ever stores the token's SHA-256 hash.
 * Rotating URL_SIGNING_SECRET therefore invalidates every distribution link (documented in docs/security.md).
 */
export async function derivePublicToken(env: AppEnv, linkId: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.URL_SIGNING_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("dist-link:" + linkId)));
}
export const linkUrl = (env: AppEnv, token: string) => `${env.APP_URL}/d/${token}`;

export async function linkDto(env: AppEnv, l: LinkRow, opts: { withUrl: boolean }) {
  const { token_hash: _t, password_hash, ...rest } = l;
  void _t;
  return {
    ...rest, state: linkState(l), password_protected: !!password_hash,
    ...(opts.withUrl && l.status !== "revoked" ? { url: linkUrl(env, await derivePublicToken(env, l.id)) } : {}),
  };
}

export async function createLink(env: AppEnv, actor: Actor, buildId: string, input: {
  title?: string; accessScope: LinkRow["access_scope"]; userIds: string[]; password?: string; expiresAt?: string | null; expiresInDays?: number;
  maxDownloads?: number | null; allowDownload: boolean; allowFeedback: boolean; customerReleaseNotes?: string | null; installationGuidance?: string | null;
}, req?: Request) {
  const { build, project } = await loadBuild(env, actor, buildId, "distribution:manage");
  if (build.publish_status !== "published") throw new ApiError("INVALID_STATE", "Publish the build before creating distribution links.");
  if (input.accessScope === "protected_link" && project.access_policy !== "allow_protected_links")
    throw new ApiError("FORBIDDEN", "This project's policy requires named-user or project-member access. Change the project's customer access policy to allow protected links.");
  if (input.accessScope === "named_users") {
    if (!input.userIds.length) throw new ApiError("VALIDATION_ERROR", "Select at least one user for named-user access.");
    const ok = await all<{ user_id: string }>(env.DB, `SELECT user_id FROM project_members WHERE project_id = ? AND status = 'active' AND user_id IN (${input.userIds.map(() => "?").join(",")})`, project.id, ...input.userIds);
    if (ok.length !== new Set(input.userIds).size) throw new ApiError("VALIDATION_ERROR", "Named users must be active members of this project.");
  }
  const org = await one<{ default_link_expiry_days: number }>(env.DB, "SELECT default_link_expiry_days FROM organisations WHERE id = ?", project.organisation_id);
  const settings = await getSettings(env);
  const expiresAt = input.expiresAt === null ? null : input.expiresAt ?? addDays(input.expiresInDays ?? org?.default_link_expiry_days ?? settings.defaultLinkExpiryDays);
  if (expiresAt && new Date(expiresAt) <= new Date()) throw new ApiError("VALIDATION_ERROR", "The expiry must be in the future.");
  const id = newId();
  const token = await derivePublicToken(env, id);
  const now = nowIso();
  const stmts = [stmt(env.DB,
    `INSERT INTO distribution_links (id, organisation_id, project_id, build_id, created_by, token_hash, title, access_scope, password_hash, expires_at, max_downloads, allow_download, allow_feedback, customer_release_notes, installation_guidance, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'active', ?)`,
    id, project.organisation_id, project.id, build.id, actor.userId, await hashToken(token), input.title ?? `${build.version ?? "Build"} (${build.build_number ?? "?"})`, input.accessScope,
    input.password ? await hashPassword(input.password) : null, expiresAt, input.maxDownloads ?? null, input.allowDownload ? 1 : 0, input.allowFeedback ? 1 : 0,
    input.customerReleaseNotes ?? null, input.installationGuidance ?? project.default_install_instructions ?? null, now)];
  if (input.accessScope === "named_users") for (const u of new Set(input.userIds)) stmts.push(stmt(env.DB, "INSERT INTO distribution_link_members (id, distribution_link_id, user_id, created_at) VALUES (?,?,?,?)", newId(), id, u, now));
  await batch(env.DB, stmts);
  await audit(env, { organisationId: project.organisation_id, actorUserId: actor.userId, action: "distribution_link.created", resourceType: "distribution_link", resourceId: id, metadata: { buildId, scope: input.accessScope, passwordProtected: !!input.password }, req });
  return linkDto(env, (await one<LinkRow>(env.DB, "SELECT * FROM distribution_links WHERE id = ?", id))!, { withUrl: true });
}

export async function listLinks(env: AppEnv, actor: Actor, buildId: string) {
  await loadBuild(env, actor, buildId, "distribution:manage");
  const rows = await all<LinkRow>(env.DB, "SELECT * FROM distribution_links WHERE build_id = ? ORDER BY created_at DESC", buildId);
  return Promise.all(rows.map((r) => linkDto(env, r, { withUrl: true })));
}

async function loadLink(env: AppEnv, actor: Actor, linkId: string, action: Parameters<typeof loadProject>[3] = "distribution:manage") {
  const link = await one<LinkRow>(env.DB, "SELECT * FROM distribution_links WHERE id = ?", linkId);
  if (!link) throw notFound("Distribution link");
  const { project } = await loadProject(env, actor, link.project_id, action);
  return { link, project };
}

export async function getLink(env: AppEnv, actor: Actor, linkId: string) {
  const { link } = await loadLink(env, actor, linkId);
  const stats = await all<{ event_type: string; n: number }>(env.DB, "SELECT event_type, COUNT(*) AS n FROM downloads WHERE distribution_link_id = ? GROUP BY event_type", linkId);
  const members = await all(env.DB, "SELECT u.id, u.display_name, u.email FROM distribution_link_members m JOIN users u ON u.id = m.user_id WHERE m.distribution_link_id = ?", linkId);
  const build = await one<BuildRow>(env.DB, "SELECT id, version, build_number, app_name FROM builds WHERE id = ?", link.build_id);
  return { ...(await linkDto(env, link, { withUrl: true })), events: Object.fromEntries(stats.map((s) => [s.event_type, s.n])), members, build };
}

export async function updateLink(env: AppEnv, actor: Actor, linkId: string, patch: { title?: string; expiresAt?: string | null; maxDownloads?: number | null; allowDownload?: boolean; allowFeedback?: boolean; customerReleaseNotes?: string | null; installationGuidance?: string | null }, req?: Request) {
  const { link, project } = await loadLink(env, actor, linkId);
  if (link.status === "revoked") throw new ApiError("INVALID_STATE", "Revoked links cannot be edited.");
  const map: [string, unknown][] = [["title", patch.title], ["expires_at", patch.expiresAt], ["max_downloads", patch.maxDownloads], ["allow_download", patch.allowDownload === undefined ? undefined : patch.allowDownload ? 1 : 0],
    ["allow_feedback", patch.allowFeedback === undefined ? undefined : patch.allowFeedback ? 1 : 0], ["customer_release_notes", patch.customerReleaseNotes], ["installation_guidance", patch.installationGuidance]];
  const sets = map.filter(([, v]) => v !== undefined);
  if (sets.length) await run(env.DB, `UPDATE distribution_links SET ${sets.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`, ...sets.map(([, v]) => v), linkId);
  await audit(env, { organisationId: project.organisation_id, actorUserId: actor.userId, action: "distribution_link.updated", resourceType: "distribution_link", resourceId: linkId, metadata: { fields: sets.map(([k]) => k) }, req });
  return getLink(env, actor, linkId);
}

export async function revokeLink(env: AppEnv, actor: Actor, linkId: string, req?: Request) {
  const { link, project } = await loadLink(env, actor, linkId);
  if (link.status !== "revoked") {
    await run(env.DB, "UPDATE distribution_links SET status = 'revoked', revoked_at = ? WHERE id = ?", nowIso(), linkId);
    await audit(env, { organisationId: project.organisation_id, actorUserId: actor.userId, action: "distribution_link.revoked", resourceType: "distribution_link", resourceId: linkId, req });
    const users = await all<{ user_id: string }>(env.DB, "SELECT user_id FROM distribution_link_members WHERE distribution_link_id = ?", linkId);
    await notify(env, { userIds: users.map((u) => u.user_id), organisationId: project.organisation_id, type: "link_revoked", title: `Access link revoked: ${link.title}`, resourceType: "distribution_link", resourceId: linkId });
  }
  return getLink(env, actor, linkId);
}

export async function qrTarget(env: AppEnv, actor: Actor, linkId: string) {
  const { link } = await loadLink(env, actor, linkId);
  const state = linkState(link);
  if (state !== "active") throw new ApiError("INVALID_STATE", `A QR code is not available because the link is ${state}.`);
  return linkUrl(env, await derivePublicToken(env, link.id));
}

export async function listProjectLinks(env: AppEnv, actor: Actor, projectId?: string) {
  const { accessibleProjects } = await import("@/lib/access");
  const ids = (await accessibleProjects(env, actor)).filter((p) => can(p.role, "distribution:manage") && (!projectId || p.id === projectId)).map((p) => p.id);
  if (!ids.length) return [];
  const rows = await all<LinkRow & { project_name: string; version: string | null; build_number: string | null }>(env.DB,
    `SELECT l.*, p.name AS project_name, b.version, b.build_number FROM distribution_links l JOIN projects p ON p.id = l.project_id JOIN builds b ON b.id = l.build_id
      WHERE l.project_id IN (${ids.map(() => "?").join(",")}) ORDER BY l.created_at DESC LIMIT 200`, ...ids);
  return Promise.all(rows.map(async (r) => ({ ...(await linkDto(env, r, { withUrl: false })), project_name: r.project_name, version: r.version, build_number: r.build_number })));
}

// ------------------------------------------------------------------ public resolution

export type AccessState = "granted" | "login_required" | "password_required" | "denied" | "unavailable";
export interface Resolved {
  link: LinkRow; build: BuildRow; project: ProjectRow; org: { id: string; name: string; status: string };
  state: LinkState; access: AccessState; user: Actor | null; staffPreview: boolean; reason?: string;
}

const grantCookieName = (linkId: string) => `dlg_${linkId.slice(0, 8)}`;
export const grantCookie = grantCookieName;

/**
 * Resolves a public token to a link and decides access. Unknown tokens → NOT_FOUND (no enumeration signal).
 * Revoked/expired links are reported generically; nothing about the build leaks unless access is granted.
 */
export async function resolveLink(env: AppEnv, req: Request, token: string, opts: { grant?: string | null } = {}): Promise<Resolved> {
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(token)) throw notFound("Link");
  const link = await one<LinkRow>(env.DB, "SELECT * FROM distribution_links WHERE token_hash = ?", await hashToken(token));
  if (!link) throw notFound("Link");
  const build = (await one<BuildRow>(env.DB, "SELECT * FROM builds WHERE id = ?", link.build_id))!;
  const project = (await one<ProjectRow>(env.DB, "SELECT * FROM projects WHERE id = ?", link.project_id))!;
  const org = (await one<{ id: string; name: string; status: string }>(env.DB, "SELECT id, name, status FROM organisations WHERE id = ?", link.organisation_id))!;
  const state = linkState(link);
  const user = await actorFromRequest(env, req);
  const base = { link, build, project, org, state, user, staffPreview: false };
  if (state !== "active") return { ...base, access: "unavailable", reason: `This link is ${state}.` };
  if (build.deleted_at || build.publish_status !== "published" || project.status !== "active" || org.status !== "active")
    return { ...base, access: "unavailable", reason: "This build is no longer available." };

  // Staff with build:view_internal may always preview (access is still audited via page_open).
  if (user) {
    const role = await projectRoleFor(env, user, project);
    if (role && can(role, "build:view_internal")) return { ...base, access: "granted", staffPreview: true };
  }
  // Short-lived signed grant (needed for iOS itms-services fetches, which carry no cookies).
  const g = opts.grant ? await verifyAccessGrant(env, opts.grant) : null;
  if (g && g.lid === link.id) return { ...base, access: "granted" };

  if (link.access_scope === "protected_link") {
    if (project.access_policy !== "allow_protected_links") return { ...base, access: "unavailable", reason: "This project no longer allows protected links." };
    if (!link.password_hash) return { ...base, access: "granted" };
    const cookie = parseCookies(req)[grantCookieName(link.id)];
    const cg = cookie ? await verifyAccessGrant(env, cookie) : null;
    return { ...base, access: cg && cg.lid === link.id ? "granted" : "password_required" };
  }
  if (!user) return { ...base, access: "login_required" };
  const role = await projectRoleFor(env, user, project);
  if (!role) return { ...base, access: "denied", reason: "Your account does not have access to this project." };
  if (link.access_scope === "named_users") {
    const m = await one(env.DB, "SELECT id FROM distribution_link_members WHERE distribution_link_id = ? AND user_id = ?", link.id, user.userId);
    if (!m) return { ...base, access: "denied", reason: "This link was not shared with your account." };
  }
  return { ...base, access: "granted" };
}

export async function submitLinkPassword(env: AppEnv, req: Request, token: string, password: string | undefined) {
  const r = await resolveLink(env, req, token);
  if (r.state !== "active") throw new ApiError("LINK_UNAVAILABLE", "This link is not available.");
  if (r.link.access_scope !== "protected_link" || !r.link.password_hash) throw new ApiError("INVALID_STATE", "This link does not use a password.");
  if (!(await verifyPassword(password ?? "", r.link.password_hash))) {
    await audit(env, { organisationId: r.link.organisation_id, actorType: "anonymous", action: "distribution_link.password_failed", resourceType: "distribution_link", resourceId: r.link.id, req });
    throw new ApiError("INVALID_CREDENTIALS", "Incorrect password.");
  }
  return { cookieName: grantCookieName(r.link.id), cookieValue: await signAccessGrant(env, { lid: r.link.id }, 3600), maxAge: 3600, path: `/d/${token}` };
}

export async function logEvent(env: AppEnv, r: Resolved, req: Request, type: "page_open" | "download_started" | "download_completed" | "manifest_requested" | "install_confirmed") {
  await run(env.DB, "INSERT INTO downloads (id, distribution_link_id, build_id, user_id, event_type, ip_hash, user_agent_summary, created_at) VALUES (?,?,?,?,?,?,?,?)",
    newId(), r.link.id, r.build.id, r.user?.userId ?? null, type, await ipHash(env, req), summariseUserAgent(req.headers.get("user-agent")), nowIso());
  await audit(env, { organisationId: r.link.organisation_id, actorUserId: r.user?.userId, action: `distribution.${type}`, resourceType: "distribution_link", resourceId: r.link.id, req });
}

/** Atomically consume one download from the link allowance. Fails when exhausted — no race can exceed max_downloads. */
export async function consumeDownload(env: AppEnv, r: Resolved): Promise<void> {
  const ok = await one(env.DB, "UPDATE distribution_links SET download_count = download_count + 1 WHERE id = ? AND status = 'active' AND (max_downloads IS NULL OR download_count < max_downloads) RETURNING id", r.link.id);
  if (!ok) throw new ApiError("LINK_UNAVAILABLE", "This link has reached its download limit.");
}

export async function latestProfileType(env: AppEnv, buildId: string) {
  const r = await one<{ profile_summary_json: string | null }>(env.DB, "SELECT profile_summary_json FROM validation_reports WHERE build_id = ? AND overall_status = 'completed' ORDER BY created_at DESC LIMIT 1", buildId);
  return parseJson<{ profileType?: string; expiresAt?: string }>(r?.profile_summary_json, {});
}

export async function installAction(env: AppEnv, r: Resolved): Promise<InstallAction> {
  const profile = await latestProfileType(env, r.build.id);
  return decideInstallAction({
    distribution_method: r.build.distribution_method, eligibility_status: r.build.eligibility_status, validation_status: r.build.validation_status,
    profileType: profile.profileType as never, external_install_url: r.build.external_install_url, allow_download_when_ineligible: r.build.allow_download_when_ineligible, link_allow_download: !!r.link.allow_download,
  });
}

/** Customer-safe view of a build for the distribution page (no internal notes, no object keys, no device identifiers). */
export async function publicView(env: AppEnv, r: Resolved) {
  const action = await installAction(env, r);
  const report = await one<{ warnings_json: string | null; limitations_json: string | null; profile_summary_json: string | null; signing_summary_json: string | null }>(env.DB,
    "SELECT warnings_json, limitations_json, profile_summary_json, signing_summary_json FROM validation_reports WHERE build_id = ? ORDER BY created_at DESC LIMIT 1", r.build.id);
  const profile = parseJson<{ profileType?: string; expiresAt?: string }>(report?.profile_summary_json, {});
  return {
    organisation: r.org.name, project: r.project.name, appName: r.build.app_name ?? r.project.app_display_name ?? r.project.name,
    version: r.build.version, buildNumber: r.build.build_number, releaseTitle: r.build.release_title,
    releaseDate: r.build.published_at, releaseNotes: r.link.customer_release_notes ?? r.build.release_notes, minimumOS: r.build.minimum_os_version,
    fileSizeBytes: r.build.file_size_bytes, distributionMethod: r.build.distribution_method, profileType: profile.profileType ?? null,
    eligibility: r.build.eligibility_status, warnings: parseJson<string[]>(report?.warnings_json, []), expiresAt: r.link.expires_at,
    installationGuidance: r.link.installation_guidance ?? r.project.default_install_instructions, qaInstructions: r.project.default_qa_instructions,
    allowFeedback: !!r.link.allow_feedback && !!r.project.feedback_enabled, action, buildId: r.build.id, projectId: r.project.id,
  };
}

export async function manifestFor(env: AppEnv, r: Resolved): Promise<string> {
  const action = await installAction(env, r);
  if (action.kind !== "ota") throw new ApiError("FORBIDDEN", "Over-the-air installation is not available for this build.");
  if (!r.build.bundle_identifier || !r.build.version) throw new ApiError("INVALID_STATE", "Validated metadata is missing.");
  return buildManifest({
    ipaUrl: await signedFileUrl(env, { k: "build", id: r.build.id, lid: r.link.id, uid: r.user?.userId }, 600),
    bundleId: r.build.bundle_identifier, version: r.build.version, title: r.build.app_name ?? r.project.name,
  });
}

export async function confirmInstall(env: AppEnv, r: Resolved, req: Request) {
  await logEvent(env, r, req, "install_confirmed");
  const staff = await projectStaffIds(env, r.project.id, r.project.organisation_id);
  void staff; // confirmations are analytics only (self-reported); no notification noise
  return { recorded: true, note: "Self-reported confirmation. The platform cannot observe installations." };
}

export async function recordAccessOrForbid(r: Resolved) {
  if (r.access !== "granted") throw forbidden("Access to this link has not been granted.");
}
