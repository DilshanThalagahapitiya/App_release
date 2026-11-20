import { beforeEach, describe, expect, it } from "vitest";
import { call, cookieFrom, fakeIpaBytes, insertUser, setupEnv, sha256OfBytes } from "../helpers/harness";
import type { AppEnv } from "@/lib/env";
import * as login from "@/app/api/v1/auth/login/route";
import * as orgs from "@/app/api/v1/organisations/route";
import * as org from "@/app/api/v1/organisations/[organisationId]/route";
import * as invite from "@/app/api/v1/organisations/[organisationId]/invitations/route";
import * as accept from "@/app/api/v1/auth/accept-invitation/route";
import * as projects from "@/app/api/v1/projects/route";
import * as pmembers from "@/app/api/v1/projects/[projectId]/members/route";
import * as usess from "@/app/api/v1/projects/[projectId]/upload-sessions/route";
import * as upart from "@/app/api/v1/upload-sessions/[sessionId]/parts/[partNumber]/route";
import * as ucomplete from "@/app/api/v1/upload-sessions/[sessionId]/complete/route";
import * as pbuilds from "@/app/api/v1/projects/[projectId]/builds/route";
import * as build from "@/app/api/v1/builds/[buildId]/route";
import * as publish from "@/app/api/v1/builds/[buildId]/publish/route";
import * as links from "@/app/api/v1/builds/[buildId]/distribution-links/route";
import * as claim from "@/app/api/v1/worker/jobs/claim/route";
import * as wstarted from "@/app/api/v1/worker/jobs/[jobId]/started/route";
import * as wcomplete from "@/app/api/v1/worker/jobs/[jobId]/complete/route";
import * as workers from "@/app/api/v1/workers/route";
import * as feedbackList from "@/app/api/v1/projects/[projectId]/feedback/route";
import * as feedbackOne from "@/app/api/v1/feedback/[feedbackId]/route";
import * as fbStatus from "@/app/api/v1/feedback/[feedbackId]/status/route";
import * as publicManifest from "@/app/d/[token]/manifest.plist/route";
import * as publicDownload from "@/app/d/[token]/download/route";
import * as files from "@/app/api/v1/files/[token]/route";
import * as qr from "@/app/api/v1/distribution-links/[linkId]/qr/route";
import { one } from "@/lib/db";
import { resolveLink, publicView } from "@/services/distribution";

/** Labelled MOCK worker report (test fixture): the platform's real validation is performed by the macOS worker. */
const mockReport = (sha: string, size: number, over: Record<string, unknown> = {}) => ({
  schemaVersion: 1, overallStatus: "completed", eligibilityStatus: "eligible",
  file: { sizeBytes: size, sha256: sha },
  app: { name: "Mock App", bundleIdentifier: "com.example.mock", version: "1.2.3", buildNumber: "45", minimumOSVersion: "16.0", deviceFamilies: [1, 2], architectures: ["arm64"] },
  signing: { verification: "valid", identitySummary: "MOCK FIXTURE", teamIdentifier: "ABCDE12345" },
  provisioning: { present: true, profileType: "ad_hoc", expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(), expired: false, deviceRegistrationRequired: true, deviceCount: 3, appIdMatchesBundle: true },
  entitlements: { getTaskAllow: false }, checks: [{ code: "MOCK", status: "passed", message: "mock fixture" }], warnings: [], errors: [], limitations: ["mock"], ...over,
});

let env: AppEnv;
let ownerCookie = ""; let adminCookie = ""; let testerCookie = "";
let orgId = ""; let projectId = ""; let testerId = ""; let workerToken = "";
const ipa = fakeIpaBytes(2048);

beforeEach(async () => {
  env = setupEnv();
  await insertUser(env, "owner@example.com", "owner-password-123", { owner: true });
  ownerCookie = cookieFrom(await call(login.POST, { body: { email: "owner@example.com", password: "owner-password-123" } }));
});

async function bootstrap() {
  const o = await call(orgs.POST, { cookie: ownerCookie, body: { name: "Acme", adminEmail: "admin@acme.test", timezone: "UTC" } });
  expect(o.status).toBe(201);
  orgId = o.data.id;
  const token = new URL(o.data.invitation.inviteUrl).searchParams.get("token")!;
  const acc = await call(accept.POST, { body: { token, displayName: "Admin", password: "admin-password-123" } });
  expect(acc.status).toBe(200);
  adminCookie = cookieFrom(acc);
  const p = await call(projects.POST, { cookie: adminCookie, body: { organisationId: orgId, name: "Mobile App", expected_bundle_identifier: "com.example.mock", access_policy: "named_users_only" } });
  expect(p.status).toBe(201);
  projectId = p.data.id;
  const inv = await call(invite.POST, { cookie: adminCookie, params: { organisationId: orgId }, body: { email: "qa@acme.test", role: "qa_tester", projectIds: [projectId] } });
  expect(inv.status).toBe(201);
  const t2 = new URL(inv.data.inviteUrl).searchParams.get("token")!;
  const acc2 = await call(accept.POST, { body: { token: t2, displayName: "Tester", password: "tester-password-123" } });
  testerCookie = cookieFrom(acc2);
  testerId = (await one<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'qa@acme.test'"))!.id;
  const w = await call(workers.POST, { cookie: ownerCookie, body: { name: "mac-mini-1" } });
  workerToken = w.data.token;
}

async function uploadBuild() {
  const sha = await sha256OfBytes(ipa);
  const s = await call(usess.POST, { cookie: adminCookie, params: { projectId }, body: { filename: "App.ipa", sizeBytes: ipa.length, sha256: sha } });
  expect(s.status).toBe(201);
  const sid = s.data.id;
  const part = await call(upart.PUT, { cookie: adminCookie, params: { sessionId: sid, partNumber: "1" }, method: "PUT", rawBody: ipa as unknown as BodyInit, headers: { "content-length": String(ipa.length) } });
  expect(part.status).toBe(200);
  const done = await call(ucomplete.POST, { cookie: adminCookie, params: { sessionId: sid } });
  expect(done.status).toBe(200);
  const b = await call(pbuilds.POST, { cookie: adminCookie, params: { projectId }, body: { uploadSessionId: sid, releaseTitle: "RC1", distributionMethod: "determine_from_ipa" } });
  expect(b.status).toBe(201);
  return { buildId: b.data.id as string, sha, sid };
}

async function workerProcess(buildId: string, sha: string, report?: Record<string, unknown>) {
  const H = { authorization: `Bearer ${workerToken}` };
  const c = await call(claim.POST, { headers: H, origin: null });
  expect(c.data.job.buildId).toBe(buildId);
  const { jobId, leaseToken, downloadUrl } = c.data.job;
  await call(wstarted.POST, { headers: H, origin: null, params: { jobId }, body: { leaseToken } });
  const done = await call(wcomplete.POST, { headers: H, origin: null, params: { jobId }, body: { leaseToken, report: report ?? mockReport(sha, ipa.length) } });
  return { done, jobId, leaseToken, downloadUrl };
}

describe("end-to-end platform flow (mocked worker report fixture)", () => {
  it("runs sign-in → org → project → invite → upload → validate → publish → link → feedback", async () => {
    await bootstrap();
    const { buildId, sha } = await uploadBuild();

    // Not publishable until validated.
    const early = await call(publish.POST, { cookie: adminCookie, params: { buildId } });
    expect(early.status).toBe(409);

    const { done, downloadUrl } = await workerProcess(buildId, sha);
    expect(done.status).toBe(200);
    // Signed worker download URL resolves to the IPA bytes (route handler).
    const token = downloadUrl.split("/api/v1/files/")[1];
    const f = await call(files.GET, { params: { token }, origin: null });
    expect(f.status).toBe(200);
    expect(f.headers.get("content-disposition")).toContain("attachment");

    const detail = await call(build.GET, { cookie: adminCookie, params: { buildId } });
    expect(detail.data.validation_status).toBe("completed");
    expect(detail.data.bundle_identifier).toBe("com.example.mock");
    expect(detail.data.eligibility_status).toBe("eligible"); // ad hoc, valid signature, unexpired matching profile
    expect(detail.data.r2_object_key).toBeUndefined();

    expect((await call(publish.POST, { cookie: adminCookie, params: { buildId } })).status).toBe(200);

    // Named-user link for the tester.
    const l = await call(links.POST, { cookie: adminCookie, params: { buildId }, body: { accessScope: "named_users", userIds: [testerId], allowDownload: true, allowFeedback: true } });
    expect(l.status).toBe(201);
    const publicToken = l.data.url.split("/d/")[1];

    // QR for the link
    const q = await call(qr.GET, { cookie: adminCookie, params: { linkId: l.data.id }, query: { format: "svg" } });
    expect(q.status).toBe(200); expect(q.text).toContain("<svg");
    const qp = await call(qr.GET, { cookie: adminCookie, params: { linkId: l.data.id }, query: { format: "png" } });
    expect(qp.status).toBe(200);

    // Anonymous cannot use a named-user link; the tester can.
    const anon = await resolveLink(env, new Request("https://portal.test/d/x"), publicToken);
    expect(anon.access).toBe("login_required");
    const asTester = await resolveLink(env, new Request("https://portal.test/d/x", { headers: { cookie: testerCookie } }), publicToken);
    expect(asTester.access).toBe("granted");
    const view = await publicView(env, asTester);
    expect(view.action.kind).toBe("ota");
    expect(JSON.stringify(view)).not.toContain("r2_object_key");

    // Manifest requires the signed grant (iOS sends no cookies).
    const noGrant = await call(publicManifest.GET, { params: { token: publicToken }, origin: null });
    expect(noGrant.status).toBe(403);
    const { signAccessGrant } = await import("@/lib/storage");
    const grant = await signAccessGrant(env, { lid: l.data.id, uid: testerId });
    const man = await call(publicManifest.GET, { params: { token: publicToken }, query: { a: grant }, origin: null });
    expect(man.status).toBe(200);
    expect(man.text).toContain("<string>com.example.mock</string>");
    expect(man.text).toContain("https://portal.test/api/v1/files/");
    const dl = await call(publicDownload.GET, { params: { token: publicToken }, query: { a: grant }, origin: null });
    expect(dl.status).toBe(403); // OTA builds are installed via manifest, not a raw IPA download

    // Feedback: tester files, admin triages, tester sees update.
    const fb = await call(feedbackList.POST, { cookie: testerCookie, params: { projectId }, body: { buildId, category: "crash", title: "Crashes on launch", description: "It crashes", severity: "high" } });
    expect(fb.status).toBe(201);
    const st = await call(fbStatus.POST, { cookie: adminCookie, params: { feedbackId: fb.data.id }, body: { status: "triaged", note: "looking" } });
    expect(st.status).toBe(200);
    const bad = await call(fbStatus.POST, { cookie: testerCookie, params: { feedbackId: fb.data.id }, body: { status: "closed" } });
    expect(bad.status).toBe(403);
    const seen = await call(feedbackOne.GET, { cookie: testerCookie, params: { feedbackId: fb.data.id } });
    expect(seen.data.status).toBe("triaged");
    const notif = await one<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'feedback_status_changed'", testerId);
    expect(notif!.n).toBe(1);

    // Audit log captured privileged actions.
    const audits = await one<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM audit_logs WHERE action IN ('build.published','distribution_link.created','organisation.created')");
    expect(audits!.n).toBeGreaterThanOrEqual(3);
  });

  it("rejects wrong checksum and short uploads", async () => {
    await bootstrap();
    const s = await call(usess.POST, { cookie: adminCookie, params: { projectId }, body: { filename: "A.ipa", sizeBytes: ipa.length, sha256: "a".repeat(64) } });
    await call(upart.PUT, { cookie: adminCookie, params: { sessionId: s.data.id, partNumber: "1" }, method: "PUT", rawBody: ipa as unknown as BodyInit, headers: { "content-length": String(ipa.length) } });
    const done = await call(ucomplete.POST, { cookie: adminCookie, params: { sessionId: s.data.id } });
    expect(done.status).toBe(422);
    const wrongSize = await call(upart.PUT, { cookie: adminCookie, params: { sessionId: s.data.id, partNumber: "1" }, method: "PUT", rawBody: new Uint8Array(10) as unknown as BodyInit, headers: { "content-length": "10" } });
    expect([409, 422]).toContain(wrongSize.status);
  });

  it("upload completion and build creation are idempotent", async () => {
    await bootstrap();
    const { sid, buildId } = await uploadBuild();
    expect((await call(ucomplete.POST, { cookie: adminCookie, params: { sessionId: sid } })).status).toBe(200);
    const again = await call(pbuilds.POST, { cookie: adminCookie, params: { projectId }, body: { uploadSessionId: sid, distributionMethod: "determine_from_ipa" } });
    expect(again.data.id).toBe(buildId);
    const jobs = await one<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM worker_jobs WHERE build_id = ?", buildId);
    expect(jobs!.n).toBe(1);
  });
});

export { mockReport, bootstrap, uploadBuild, workerProcess };
