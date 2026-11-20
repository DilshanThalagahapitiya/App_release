import { expect } from "vitest";
import { call, cookieFrom, fakeIpaBytes, insertUser, setupEnv, sha256OfBytes } from "./harness";
import type { AppEnv } from "@/lib/env";
import { one } from "@/lib/db";
import * as login from "@/app/api/v1/auth/login/route";
import * as orgs from "@/app/api/v1/organisations/route";
import * as invite from "@/app/api/v1/organisations/[organisationId]/invitations/route";
import * as accept from "@/app/api/v1/auth/accept-invitation/route";
import * as projects from "@/app/api/v1/projects/route";
import * as usess from "@/app/api/v1/projects/[projectId]/upload-sessions/route";
import * as upart from "@/app/api/v1/upload-sessions/[sessionId]/parts/[partNumber]/route";
import * as ucomplete from "@/app/api/v1/upload-sessions/[sessionId]/complete/route";
import * as pbuilds from "@/app/api/v1/projects/[projectId]/builds/route";
import * as publish from "@/app/api/v1/builds/[buildId]/publish/route";
import * as links from "@/app/api/v1/builds/[buildId]/distribution-links/route";
import * as claim from "@/app/api/v1/worker/jobs/claim/route";
import * as wstarted from "@/app/api/v1/worker/jobs/[jobId]/started/route";
import * as wcomplete from "@/app/api/v1/worker/jobs/[jobId]/complete/route";
import * as workers from "@/app/api/v1/workers/route";

/** LABELLED MOCK worker report (test fixture). Real validation is done by the macOS worker, never here. */
export const mockReport = (sha: string, size: number, over: Record<string, unknown> = {}) => ({
  schemaVersion: 1, overallStatus: "completed", eligibilityStatus: "eligible", file: { sizeBytes: size, sha256: sha },
  app: { name: "Mock App", bundleIdentifier: "com.example.mock", version: "1.2.3", buildNumber: "45", minimumOSVersion: "16.0", deviceFamilies: [1, 2], architectures: ["arm64"] },
  signing: { verification: "valid", identitySummary: "MOCK FIXTURE", teamIdentifier: "ABCDE12345" },
  provisioning: { present: true, profileType: "ad_hoc", expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(), expired: false, deviceRegistrationRequired: true, deviceCount: 3, appIdMatchesBundle: true },
  entitlements: { getTaskAllow: false }, checks: [{ code: "MOCK", status: "passed", message: "mock fixture" }], warnings: [], errors: [], limitations: ["mock"], ...over,
});

export const ipa = fakeIpaBytes(2048);

export interface Tenant { orgId: string; adminCookie: string; projectId: string; testerCookie: string; testerId: string; adminId: string }

export async function createScenario() {
  const env: AppEnv = setupEnv();
  await insertUser(env, "owner@example.com", "owner-password-123", { owner: true });
  const ownerCookie = cookieFrom(await call(login.POST, { body: { email: "owner@example.com", password: "owner-password-123" } }));
  const w = await call(workers.POST, { cookie: ownerCookie, body: { name: "mac-mini-1" } });
  const workerToken: string = w.data.token;

  async function tenant(name: string): Promise<Tenant> {
    const slug = name.toLowerCase();
    const o = await call(orgs.POST, { cookie: ownerCookie, body: { name, adminEmail: `admin@${slug}.test`, timezone: "UTC" } });
    const orgId = o.data.id as string;
    const acc = await call(accept.POST, { body: { token: new URL(o.data.invitation.inviteUrl).searchParams.get("token")!, displayName: `${name} Admin`, password: "admin-password-123" } });
    const adminCookie = cookieFrom(acc);
    const p = await call(projects.POST, { cookie: adminCookie, body: { organisationId: orgId, name: `${name} App`, expected_bundle_identifier: "com.example.mock" } });
    const projectId = p.data.id as string;
    const inv = await call(invite.POST, { cookie: adminCookie, params: { organisationId: orgId }, body: { email: `qa@${slug}.test`, role: "qa_tester", projectIds: [projectId] } });
    const acc2 = await call(accept.POST, { body: { token: new URL(inv.data.inviteUrl).searchParams.get("token")!, displayName: `${name} Tester`, password: "tester-password-123" } });
    const testerId = (await one<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = ?", `qa@${slug}.test`))!.id;
    const adminId = (await one<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = ?", `admin@${slug}.test`))!.id;
    return { orgId, adminCookie, projectId, testerCookie: cookieFrom(acc2), testerId, adminId };
  }

  async function uploadBuild(t: Tenant, bytes = ipa) {
    const sha = await sha256OfBytes(bytes);
    const s = await call(usess.POST, { cookie: t.adminCookie, params: { projectId: t.projectId }, body: { filename: "App.ipa", sizeBytes: bytes.length, sha256: sha } });
    expect(s.status).toBe(201);
    await call(upart.PUT, { cookie: t.adminCookie, params: { sessionId: s.data.id, partNumber: "1" }, method: "PUT", rawBody: bytes as unknown as BodyInit, headers: { "content-length": String(bytes.length) } });
    expect((await call(ucomplete.POST, { cookie: t.adminCookie, params: { sessionId: s.data.id } })).status).toBe(200);
    const b = await call(pbuilds.POST, { cookie: t.adminCookie, params: { projectId: t.projectId }, body: { uploadSessionId: s.data.id, releaseTitle: "RC", distributionMethod: "determine_from_ipa" } });
    expect(b.status).toBe(201);
    return { buildId: b.data.id as string, sha, sessionId: s.data.id as string };
  }

  const H = (token = workerToken) => ({ authorization: `Bearer ${token}` });
  async function claimJob(token = workerToken) {
    const c = await call(claim.POST, { headers: H(token), origin: null });
    return c.data?.job as { jobId: string; buildId: string; leaseToken: string; downloadUrl: string; attempt: number } | null;
  }
  async function complete(job: { jobId: string; leaseToken: string }, report: unknown, token = workerToken) {
    await call(wstarted.POST, { headers: H(token), origin: null, params: { jobId: job.jobId }, body: { leaseToken: job.leaseToken } });
    return call(wcomplete.POST, { headers: H(token), origin: null, params: { jobId: job.jobId }, body: { leaseToken: job.leaseToken, report } });
  }
  async function validateAndPublish(t: Tenant, bytes = ipa) {
    const { buildId, sha } = await uploadBuild(t, bytes);
    const job = (await claimJob())!;
    expect((await complete(job, mockReport(sha, bytes.length))).status).toBe(200);
    expect((await call(publish.POST, { cookie: t.adminCookie, params: { buildId } })).status).toBe(200);
    return { buildId, sha };
  }
  async function makeLink(t: Tenant, buildId: string, body: Record<string, unknown> = {}) {
    const l = await call(links.POST, { cookie: t.adminCookie, params: { buildId }, body: { accessScope: "project_members", userIds: [], allowDownload: true, allowFeedback: true, ...body } });
    return l;
  }
  return { env, ownerCookie, workerToken, tenant, uploadBuild, claimJob, complete, validateAndPublish, makeLink, H };
}
