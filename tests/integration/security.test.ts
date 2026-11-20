import { beforeEach, describe, expect, it } from "vitest";
import { call, cookieFrom, insertUser } from "../helpers/harness";
import { createScenario, ipa, mockReport } from "../helpers/scenario";
import { one, run } from "@/lib/db";
import { resolveLink, consumeDownload } from "@/services/distribution";
import { signAccessGrant } from "@/lib/storage";
import * as login from "@/app/api/v1/auth/login/route";
import * as proj from "@/app/api/v1/projects/[projectId]/route";
import * as projects from "@/app/api/v1/projects/route";
import * as build from "@/app/api/v1/builds/[buildId]/route";
import * as pbuilds from "@/app/api/v1/projects/[projectId]/builds/route";
import * as validation from "@/app/api/v1/builds/[buildId]/validation/route";
import * as dlurl from "@/app/api/v1/builds/[buildId]/download/route";
import * as link from "@/app/api/v1/distribution-links/[linkId]/route";
import * as revoke from "@/app/api/v1/distribution-links/[linkId]/revoke/route";
import * as feedbackPost from "@/app/api/v1/projects/[projectId]/feedback/route";
import * as feedbackOne from "@/app/api/v1/feedback/[feedbackId]/route";
import * as comments from "@/app/api/v1/feedback/[feedbackId]/comments/route";
import * as fbList from "@/app/api/v1/feedback/route";
import * as attSession from "@/app/api/v1/feedback/[feedbackId]/attachments/upload-session/route";
import * as attContent from "@/app/api/v1/feedback-attachments/[attachmentId]/content/route";
import * as attUrl from "@/app/api/v1/feedback-attachments/[attachmentId]/url/route";
import * as files from "@/app/api/v1/files/[token]/route";
import * as usess from "@/app/api/v1/projects/[projectId]/upload-sessions/route";
import * as ucomplete from "@/app/api/v1/upload-sessions/[sessionId]/complete/route";
import * as claim from "@/app/api/v1/worker/jobs/claim/route";
import * as wcomplete from "@/app/api/v1/worker/jobs/[jobId]/complete/route";
import * as wfail from "@/app/api/v1/worker/jobs/[jobId]/fail/route";
import * as workersApi from "@/app/api/v1/workers/route";
import * as workerOne from "@/app/api/v1/workers/[workerId]/route";
import * as members from "@/app/api/v1/organisations/[organisationId]/members/route";
import * as audit from "@/app/api/v1/audit-logs/route";
import * as settings from "@/app/api/v1/settings/route";
import * as auth from "@/app/api/v1/auth/me/route";
import { runFrequent } from "@/services/maintenance";
import { sha256Hex } from "@/lib/crypto";

let S: Awaited<ReturnType<typeof createScenario>>;
beforeEach(async () => { S = await createScenario(); });

describe("tenant & project isolation", () => {
  it("denies cross-organisation reads/writes with 404 (no existence leak)", async () => {
    const a = await S.tenant("Alpha"); const b = await S.tenant("Bravo");
    const { buildId } = await S.validateAndPublish(a);
    for (const [h, params] of [[proj.GET, { projectId: a.projectId }], [build.GET, { buildId }], [validation.GET, { buildId }]] as const) {
      const r = await call(h as never, { cookie: b.adminCookie, params: params as Record<string, string> });
      expect(r.status).toBe(404);
    }
    expect((await call(proj.PATCH, { cookie: b.adminCookie, params: { projectId: a.projectId }, body: { name: "pwned" } })).status).toBe(404);
    expect((await call(build.DELETE, { cookie: b.adminCookie, params: { buildId } })).status).toBe(404);
    expect((await call(dlurl.POST, { cookie: b.adminCookie, params: { buildId } })).status).toBe(404);
    const list = await call(projects.GET, { cookie: b.adminCookie });
    expect(list.data.items.map((p: { id: string }) => p.id)).not.toContain(a.projectId);
    expect((await call(members.GET, { cookie: b.adminCookie, params: { organisationId: a.orgId } })).status).toBe(404);
  });

  it("a tester in one project cannot reach another project's builds or feedback", async () => {
    const a = await S.tenant("Alpha");
    const second = await call(projects.POST, { cookie: a.adminCookie, body: { organisationId: a.orgId, name: "Second" } });
    const { buildId } = await S.validateAndPublish(a);
    expect((await call(pbuilds.GET, { cookie: a.testerCookie, params: { projectId: second.data.id } })).status).toBe(404);
    // tester has only viewer-ish access in project 1: cannot see internal fields or mutate
    const own = await call(build.GET, { cookie: a.testerCookie, params: { buildId } });
    expect(own.status).toBe(200);
    expect(own.data.internal_notes).toBeUndefined();
    expect((await call(build.PATCH, { cookie: a.testerCookie, params: { buildId }, body: { release_notes: "x" } })).status).toBe(403);
    expect((await call(validation.GET, { cookie: a.testerCookie, params: { buildId } })).status).toBe(403);
    expect((await call(dlurl.POST, { cookie: a.testerCookie, params: { buildId } })).status).toBe(403);
    expect((await call(build.DELETE, { cookie: a.testerCookie, params: { buildId } })).status).toBe(403);
  });

  it("unpublished builds are invisible to non-staff", async () => {
    const a = await S.tenant("Alpha");
    const { buildId } = await S.uploadBuild(a);
    expect((await call(build.GET, { cookie: a.testerCookie, params: { buildId } })).status).toBe(404);
  });

  it("customers only see their own feedback; internal comments are hidden", async () => {
    const a = await S.tenant("Alpha");
    const inv2 = await insertUser(S.env, "qa2@alpha.test", "tester-password-123");
    await run(S.env.DB, "INSERT INTO organisation_members (id, organisation_id, user_id, role, status, created_at) VALUES (?,?,?,?,?,?)", crypto.randomUUID(), a.orgId, inv2, "qa_tester", "active", new Date().toISOString());
    await run(S.env.DB, "INSERT INTO project_members (id, project_id, user_id, role, status, created_at) VALUES (?,?,?,?,?,?)", crypto.randomUUID(), a.projectId, inv2, "qa_tester", "active", new Date().toISOString());
    const c2 = cookieFrom(await call(login.POST, { body: { email: "qa2@alpha.test", password: "tester-password-123" } }));
    const f1 = await call(feedbackPost.POST, { cookie: a.testerCookie, params: { projectId: a.projectId }, body: { category: "crash", title: "Mine", description: "details", severity: "low" } });
    expect(f1.status).toBe(201);
    expect((await call(feedbackOne.GET, { cookie: c2, params: { feedbackId: f1.data.id } })).status).toBe(404);
    expect((await call(fbList.GET, { cookie: c2 })).data.total).toBe(0);
    expect((await call(fbList.GET, { cookie: a.adminCookie })).data.total).toBe(1);
    await call(comments.POST, { cookie: a.adminCookie, params: { feedbackId: f1.data.id }, body: { body: "secret triage note", visibility: "internal" } });
    await call(comments.POST, { cookie: a.adminCookie, params: { feedbackId: f1.data.id }, body: { body: "public reply", visibility: "customer" } });
    const seen = await call(feedbackOne.GET, { cookie: a.testerCookie, params: { feedbackId: f1.data.id } });
    expect(JSON.stringify(seen.data)).not.toContain("secret triage note");
    expect(JSON.stringify(seen.data)).toContain("public reply");
    const forged = await call(comments.POST, { cookie: a.testerCookie, params: { feedbackId: f1.data.id }, body: { body: "sneaky", visibility: "internal" } });
    expect(forged.status).toBe(403);
  });

  it("cannot attach a build from another project to feedback", async () => {
    const a = await S.tenant("Alpha"); const b = await S.tenant("Bravo");
    const { buildId } = await S.validateAndPublish(b);
    const r = await call(feedbackPost.POST, { cookie: a.testerCookie, params: { projectId: a.projectId }, body: { buildId, category: "other", title: "xx", description: "yy", severity: "low" } });
    expect(r.status).toBe(422);
  });
});

describe("authentication & sessions", () => {
  it("returns the same error for unknown users and wrong passwords", async () => {
    const a = await call(login.POST, { body: { email: "nobody@example.com", password: "whatever-pass" } });
    const b = await call(login.POST, { body: { email: "owner@example.com", password: "wrong-pass-1234" } });
    expect(a.status).toBe(401); expect(b.status).toBe(401);
    expect(a.error.message).toBe(b.error.message);
  });
  it("locks the account after repeated failures and throttles by IP", async () => {
    for (let i = 0; i < 5; i++) await call(login.POST, { body: { email: "owner@example.com", password: "bad-password-" + i }, headers: { "cf-connecting-ip": "1.1.1.1" } });
    const locked = await call(login.POST, { body: { email: "owner@example.com", password: "owner-password-123" }, headers: { "cf-connecting-ip": "1.1.1.1" } });
    expect([401, 429]).toContain(locked.status);
    expect(locked.status === 401 || locked.status === 429).toBe(true);
  });
  it("rate limiting returns 429 with Retry-After", async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await call(login.POST, { body: { email: "x@example.com", password: "p" + i }, headers: { "cf-connecting-ip": "9.9.9.9" } })).status;
    expect(last).toBe(429);
  });
  it("revokes sessions when a member is deactivated and rejects cross-site writes", async () => {
    const a = await S.tenant("Alpha");
    expect((await call(auth.GET, { cookie: a.testerCookie })).status).toBe(200);
    const m = await one<{ id: string }>(S.env.DB, "SELECT id FROM organisation_members WHERE user_id = ?", a.testerId);
    const { PATCH } = await import("@/app/api/v1/organisations/[organisationId]/members/[memberId]/route");
    expect((await call(PATCH, { cookie: a.adminCookie, params: { organisationId: a.orgId, memberId: m!.id }, body: { status: "deactivated" } })).status).toBe(200);
    expect((await call(auth.GET, { cookie: a.testerCookie })).status).toBe(401);
    // CSRF: cookie-authenticated mutation from a foreign origin is refused
    expect((await call(projects.POST, { cookie: a.adminCookie, origin: "https://evil.example", body: { organisationId: a.orgId, name: "x" } })).status).toBe(403);
  });
  it("cannot remove the last organisation admin", async () => {
    const a = await S.tenant("Alpha");
    const m = await one<{ id: string }>(S.env.DB, "SELECT id FROM organisation_members WHERE user_id = ?", a.adminId);
    const { PATCH } = await import("@/app/api/v1/organisations/[organisationId]/members/[memberId]/route");
    const second = await call(PATCH, { cookie: S.ownerCookie, params: { organisationId: a.orgId, memberId: m!.id }, body: { role: "viewer" } });
    expect(second.status).toBe(409);
  });
  it("platform settings are Platform Owner only", async () => {
    const a = await S.tenant("Alpha");
    expect((await call(settings.PUT, { method: "PUT", cookie: a.adminCookie, body: { maxIpaBytes: 5 * 1024 * 1024 } })).status).toBe(403);
    expect((await call(settings.PUT, { method: "PUT", cookie: S.ownerCookie, body: { maxIpaBytes: 5 * 1024 * 1024 } })).status).toBe(200);
  });
  it("audit logs are scoped to administrators of the organisation", async () => {
    const a = await S.tenant("Alpha"); const b = await S.tenant("Bravo");
    expect((await call(audit.GET, { cookie: a.testerCookie })).status).toBe(403);
    const mine = await call(audit.GET, { cookie: a.adminCookie });
    expect(mine.status).toBe(200);
    expect(mine.data.items.every((i: { organisation_id: string }) => i.organisation_id === a.orgId)).toBe(true);
    const other = await call(audit.GET, { cookie: a.adminCookie, query: { organisationId: b.orgId } });
    expect(other.status).toBe(403);
  });
});

describe("distribution links", () => {
  it("enforces expiry, revocation and exhaustion; tokens are stored hashed", async () => {
    const a = await S.tenant("Alpha");
    const { buildId } = await S.validateAndPublish(a);
    const l = await S.makeLink(a, buildId, { accessScope: "project_members", maxDownloads: 1 });
    expect(l.status).toBe(201);
    const token = l.data.url.split("/d/")[1];
    const row = await one<{ token_hash: string }>(S.env.DB, "SELECT token_hash FROM distribution_links WHERE id = ?", l.data.id);
    expect(row!.token_hash).not.toContain(token); expect(row!.token_hash).toHaveLength(64);
    const req = (cookie?: string) => new Request("https://portal.test/d/x", { headers: cookie ? { cookie } : {} });
    expect((await resolveLink(S.env, req(a.testerCookie), token)).access).toBe("granted");
    // exhaust
    const r = await resolveLink(S.env, req(a.testerCookie), token);
    await consumeDownload(S.env, r);
    await expect(consumeDownload(S.env, r)).rejects.toMatchObject({ code: "LINK_UNAVAILABLE" });
    expect((await resolveLink(S.env, req(a.testerCookie), token)).state).toBe("exhausted");
    // expiry
    const l2 = await S.makeLink(a, buildId);
    const t2 = l2.data.url.split("/d/")[1];
    await run(S.env.DB, "UPDATE distribution_links SET expires_at = ? WHERE id = ?", new Date(Date.now() - 1000).toISOString(), l2.data.id);
    expect((await resolveLink(S.env, req(a.testerCookie), t2)).access).toBe("unavailable");
    // revoke
    const l3 = await S.makeLink(a, buildId);
    const t3 = l3.data.url.split("/d/")[1];
    expect((await call(revoke.POST, { cookie: a.adminCookie, params: { linkId: l3.data.id } })).status).toBe(200);
    const rr = await resolveLink(S.env, req(a.testerCookie), t3);
    expect(rr.state).toBe("revoked"); expect(rr.access).toBe("unavailable");
    // unknown / malformed tokens give a uniform not-found
    await expect(resolveLink(S.env, req(), "A".repeat(43))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(resolveLink(S.env, req(), "short")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("named-user links reject other project members; protected links honour project policy and passwords", async () => {
    const a = await S.tenant("Alpha");
    const { buildId } = await S.validateAndPublish(a);
    const other = await insertUser(S.env, "other@alpha.test", "other-password-123");
    await run(S.env.DB, "INSERT INTO organisation_members (id, organisation_id, user_id, role, status, created_at) VALUES (?,?,?,?,?,?)", crypto.randomUUID(), a.orgId, other, "qa_tester", "active", new Date().toISOString());
    await run(S.env.DB, "INSERT INTO project_members (id, project_id, user_id, role, status, created_at) VALUES (?,?,?,?,?,?)", crypto.randomUUID(), a.projectId, other, "qa_tester", "active", new Date().toISOString());
    const oc = cookieFrom(await call(login.POST, { body: { email: "other@alpha.test", password: "other-password-123" } }));
    const l = await S.makeLink(a, buildId, { accessScope: "named_users", userIds: [a.testerId] });
    const tok = l.data.url.split("/d/")[1];
    const mk = (c: string) => new Request("https://portal.test/d/x", { headers: { cookie: c } });
    expect((await resolveLink(S.env, mk(a.testerCookie), tok)).access).toBe("granted");
    expect((await resolveLink(S.env, mk(oc), tok)).access).toBe("denied");
    // protected links blocked by default policy
    expect((await S.makeLink(a, buildId, { accessScope: "protected_link" })).status).toBe(403);
    await call(proj.PATCH, { cookie: a.adminCookie, params: { projectId: a.projectId }, body: { access_policy: "allow_protected_links" } });
    const pl = await S.makeLink(a, buildId, { accessScope: "protected_link", password: "hunter22" });
    expect(pl.status).toBe(201);
    const pt = pl.data.url.split("/d/")[1];
    expect((await resolveLink(S.env, new Request("https://portal.test/d/x"), pt)).access).toBe("password_required");
    const { submitLinkPassword } = await import("@/services/distribution");
    await expect(submitLinkPassword(S.env, new Request("https://portal.test/d/x"), pt, "nope")).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    const g = await submitLinkPassword(S.env, new Request("https://portal.test/d/x"), pt, "hunter22");
    expect((await resolveLink(S.env, new Request("https://portal.test/d/x", { headers: { cookie: `${g.cookieName}=${encodeURIComponent(g.cookieValue)}` } }), pt)).access).toBe("granted");
    // forged / foreign grants are refused
    const forged = await signAccessGrant({ ...S.env, URL_SIGNING_SECRET: "other-secret-other-secret-other" }, { lid: pl.data.id });
    expect((await resolveLink(S.env, new Request("https://portal.test/d/x"), pt, { grant: forged })).access).toBe("password_required");
  });
  it("unpublishing a build disables its links immediately", async () => {
    const a = await S.tenant("Alpha");
    const { buildId } = await S.validateAndPublish(a);
    const l = await S.makeLink(a, buildId);
    const tok = l.data.url.split("/d/")[1];
    const { POST } = await import("@/app/api/v1/builds/[buildId]/unpublish/route");
    await call(POST, { cookie: a.adminCookie, params: { buildId } });
    expect((await resolveLink(S.env, new Request("https://portal.test/d/x", { headers: { cookie: a.testerCookie } }), tok)).access).toBe("unavailable");
  });
  it("link details never include the password hash or token hash", async () => {
    const a = await S.tenant("Alpha");
    const { buildId } = await S.validateAndPublish(a);
    await call(proj.PATCH, { cookie: a.adminCookie, params: { projectId: a.projectId }, body: { access_policy: "allow_protected_links" } });
    const l = await S.makeLink(a, buildId, { accessScope: "protected_link", password: "hunter22" });
    const d = await call(link.GET, { cookie: a.adminCookie, params: { linkId: l.data.id } });
    expect(JSON.stringify(d.data)).not.toMatch(/token_hash|password_hash/);
  });
});

describe("worker protocol", () => {
  it("rejects missing/invalid/revoked worker credentials", async () => {
    expect((await call(claim.POST, { origin: null })).status).toBe(401);
    expect((await call(claim.POST, { origin: null, headers: { authorization: "Bearer wkr_" + "x".repeat(40) } })).status).toBe(401);
    const w = await call(workersApi.POST, { cookie: S.ownerCookie, body: { name: "temp" } });
    expect((await call(claim.POST, { origin: null, headers: S.H(w.data.token) })).status).toBe(200);
    await call(workerOne.DELETE, { cookie: S.ownerCookie, params: { workerId: w.data.id } });
    expect((await call(claim.POST, { origin: null, headers: S.H(w.data.token) })).status).toBe(401);
  });
  it("a worker cannot complete or fail another worker's job; leases and replays are enforced", async () => {
    const a = await S.tenant("Alpha");
    const { buildId, sha } = await S.uploadBuild(a);
    const w2 = (await call(workersApi.POST, { cookie: S.ownerCookie, body: { name: "second" } })).data.token as string;
    const job = (await S.claimJob())!;
    expect(job.buildId).toBe(buildId);
    expect(await S.claimJob(w2)).toBeNull(); // atomic claim: nothing left
    const stolen = await call(wcomplete.POST, { origin: null, headers: S.H(w2), params: { jobId: job.jobId }, body: { leaseToken: job.leaseToken, report: mockReport(sha, ipa.length) } });
    expect(stolen.status).toBe(409);
    expect((await call(wfail.POST, { origin: null, headers: S.H(w2), params: { jobId: job.jobId }, body: { leaseToken: job.leaseToken, errorCode: "X", message: "m" } })).status).toBe(409);
    const badLease = await call(wcomplete.POST, { origin: null, headers: S.H(), params: { jobId: job.jobId }, body: { leaseToken: "z".repeat(24), report: mockReport(sha, ipa.length) } });
    expect(badLease.status).toBe(409);
    expect((await S.complete(job, mockReport(sha, ipa.length))).status).toBe(200);
    const replay = await call(wcomplete.POST, { origin: null, headers: S.H(), params: { jobId: job.jobId }, body: { leaseToken: job.leaseToken, report: mockReport(sha, ipa.length) } });
    expect(replay.data.replay).toBe(true);
    expect((await one<{ n: number }>(S.env.DB, "SELECT COUNT(*) AS n FROM validation_reports WHERE build_id = ?", buildId))!.n).toBe(1);
  });
  it("reclaims expired leases, retries with backoff, then fails permanently", async () => {
    const a = await S.tenant("Alpha");
    const { buildId } = await S.uploadBuild(a);
    const job = (await S.claimJob())!;
    await run(S.env.DB, "UPDATE worker_jobs SET lease_expires_at = ? WHERE id = ?", new Date(Date.now() - 1000).toISOString(), job.jobId);
    await runFrequent(S.env);
    expect((await one<{ status: string }>(S.env.DB, "SELECT status FROM worker_jobs WHERE id = ?", job.jobId))!.status).toBe("queued");
    // retryable failure -> queued with next_attempt_at in the future
    const j2 = (await S.claimJob())!; expect(j2.attempt).toBe(2);
    const f = await call(wfail.POST, { origin: null, headers: S.H(), params: { jobId: j2.jobId }, body: { leaseToken: j2.leaseToken, errorCode: "DOWNLOAD_FAILED", message: "net", retryable: true } });
    expect(f.data.status).toBe("queued");
    expect(await S.claimJob()).toBeNull(); // backoff not elapsed
    await run(S.env.DB, "UPDATE worker_jobs SET next_attempt_at = NULL WHERE id = ?", j2.jobId);
    const j3 = (await S.claimJob())!; expect(j3.attempt).toBe(3);
    const f3 = await call(wfail.POST, { origin: null, headers: S.H(), params: { jobId: j3.jobId }, body: { leaseToken: j3.leaseToken, errorCode: "DOWNLOAD_FAILED", message: "net", retryable: true } });
    expect(f3.data.status).toBe("failed"); // attempts exhausted
    expect((await one<{ validation_status: string; eligibility_status: string }>(S.env.DB, "SELECT validation_status, eligibility_status FROM builds WHERE id = ?", buildId))).toMatchObject({ validation_status: "failed", eligibility_status: "needs_review" });
  });
  it("definitive IPA failures mark the build not eligible and are never retried", async () => {
    const a = await S.tenant("Alpha");
    const { buildId } = await S.uploadBuild(a);
    const job = (await S.claimJob())!;
    const f = await call(wfail.POST, { origin: null, headers: S.H(), params: { jobId: job.jobId }, body: { leaseToken: job.leaseToken, errorCode: "IPA_NOT_ZIP", message: "bad zip", retryable: false } });
    expect(f.data.status).toBe("failed");
    expect((await one<{ eligibility_status: string }>(S.env.DB, "SELECT eligibility_status FROM builds WHERE id = ?", buildId))!.eligibility_status).toBe("not_eligible");
  });
  it("rejects malformed reports and checksum mismatches", async () => {
    const a = await S.tenant("Alpha");
    const { buildId, sha } = await S.uploadBuild(a);
    const job = (await S.claimJob())!;
    expect((await S.complete(job, { schemaVersion: 2 })).status).toBe(422);
    const mismatch = await call(wcomplete.POST, { origin: null, headers: S.H(), params: { jobId: job.jobId }, body: { leaseToken: job.leaseToken, report: mockReport("0".repeat(64), ipa.length) } });
    expect(mismatch.data.status).toBe("failed");
    expect((await one<{ validation_status: string }>(S.env.DB, "SELECT validation_status FROM builds WHERE id = ?", buildId))!.validation_status).toBe("failed");
    void sha;
  });
  it("the API keeps the more conservative eligibility: a lying worker cannot upgrade a build", async () => {
    const a = await S.tenant("Alpha");
    const { buildId, sha } = await S.uploadBuild(a);
    const job = (await S.claimJob())!;
    const lie = mockReport(sha, ipa.length, { eligibilityStatus: "eligible", signing: { verification: "invalid" } });
    expect((await S.complete(job, lie)).status).toBe(200);
    expect((await one<{ eligibility_status: string }>(S.env.DB, "SELECT eligibility_status FROM builds WHERE id = ?", buildId))!.eligibility_status).toBe("not_eligible");
    const { POST } = await import("@/app/api/v1/builds/[buildId]/publish/route");
    expect((await call(POST, { cookie: a.adminCookie, params: { buildId } })).status).toBe(409); // not publishable unless download-only is explicitly allowed
  });
});

describe("uploads & files", () => {
  it("rejects oversized declarations, non-.ipa names, wrong checksums and non-zip content", async () => {
    const a = await S.tenant("Alpha");
    expect((await call(usess.POST, { cookie: a.adminCookie, params: { projectId: a.projectId }, body: { filename: "x.ipa", sizeBytes: 3 * 1024 ** 3, sha256: "a".repeat(64) } })).status).toBe(413);
    expect((await call(usess.POST, { cookie: a.adminCookie, params: { projectId: a.projectId }, body: { filename: "x.zip", sizeBytes: 10, sha256: "a".repeat(64) } })).status).toBe(422);
    const junk = new Uint8Array(512).fill(65);
    const s = await call(usess.POST, { cookie: a.adminCookie, params: { projectId: a.projectId }, body: { filename: "x.ipa", sizeBytes: 512, sha256: await sha256Hex(junk) } });
    const { PUT } = await import("@/app/api/v1/upload-sessions/[sessionId]/parts/[partNumber]/route");
    await call(PUT, { cookie: a.adminCookie, method: "PUT", params: { sessionId: s.data.id, partNumber: "1" }, rawBody: junk as unknown as BodyInit, headers: { "content-length": "512" } });
    const done = await call(ucomplete.POST, { cookie: a.adminCookie, params: { sessionId: s.data.id } });
    expect(done.status).toBe(422); expect(done.error.message).toMatch(/ZIP/);
    expect((S.env.BUCKET as unknown as { _store: Map<string, unknown> })._store.size).toBe(0); // rejected object deleted
  });
  it("another user cannot use someone else's upload session", async () => {
    const a = await S.tenant("Alpha");
    const s = await call(usess.POST, { cookie: a.adminCookie, params: { projectId: a.projectId }, body: { filename: "x.ipa", sizeBytes: 100, sha256: "a".repeat(64) } });
    expect((await call(ucomplete.POST, { cookie: a.testerCookie, params: { sessionId: s.data.id } })).status).toBe(404);
  });
  it("validates attachment content by magic bytes and serves them via short-lived signed URLs only", async () => {
    const a = await S.tenant("Alpha"); const b = await S.tenant("Bravo");
    const f = await call(feedbackPost.POST, { cookie: a.testerCookie, params: { projectId: a.projectId }, body: { category: "crash", title: "t t", description: "d d", severity: "low" } });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    expect((await call(attSession.POST, { cookie: a.testerCookie, params: { feedbackId: f.data.id }, body: { filename: "a.html", mimeType: "text/html", sizeBytes: 10 } })).status).toBe(415);
    expect((await call(attSession.POST, { cookie: a.testerCookie, params: { feedbackId: f.data.id }, body: { filename: "a.png", mimeType: "image/png", sizeBytes: 50 * 1024 * 1024 } })).status).toBe(413);
    // declared PNG but HTML bytes → rejected
    const s1 = await call(attSession.POST, { cookie: a.testerCookie, params: { feedbackId: f.data.id }, body: { filename: "evil.png", mimeType: "image/png", sizeBytes: 12 } });
    const html = new TextEncoder().encode("<script>x</script>");
    const bad = await call(attContent.PUT, { cookie: a.testerCookie, method: "PUT", params: { attachmentId: s1.data.attachmentId }, rawBody: html.slice(0, 12) as unknown as BodyInit, headers: { "content-length": "12" } });
    expect(bad.status).toBe(415);
    const s2 = await call(attSession.POST, { cookie: a.testerCookie, params: { feedbackId: f.data.id }, body: { filename: "ok.png", mimeType: "image/png", sizeBytes: 12 } });
    const ok = await call(attContent.PUT, { cookie: a.testerCookie, method: "PUT", params: { attachmentId: s2.data.attachmentId }, rawBody: png as unknown as BodyInit, headers: { "content-length": "12" } });
    expect(ok.status).toBe(200);
    // another tenant cannot mint a URL
    expect((await call(attUrl.GET, { cookie: b.adminCookie, params: { attachmentId: s2.data.attachmentId } })).status).toBe(404);
    const u = await call(attUrl.GET, { cookie: a.adminCookie, params: { attachmentId: s2.data.attachmentId } });
    expect(u.status).toBe(200);
    const token = u.data.url.split("/files/")[1];
    const served = await call(files.GET, { params: { token }, origin: null });
    expect(served.status).toBe(200);
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(served.headers.get("cache-control")).toContain("no-store");
    expect(served.headers.get("content-security-policy")).toContain("sandbox");
    expect((await call(files.GET, { params: { token: token.slice(0, -3) + "abc" }, origin: null })).status).toBe(403); // tampered signature
    expect((await call(feedbackOne.GET, { cookie: b.adminCookie, params: { feedbackId: f.data.id } })).status).toBe(404);
  });
  it("expired signed file URLs are refused", async () => {
    const a = await S.tenant("Alpha");
    const { buildId } = await S.uploadBuild(a);
    const { signedFileUrl } = await import("@/lib/storage");
    const url = await signedFileUrl(S.env, { k: "build", id: buildId }, -10);
    expect((await call(files.GET, { params: { token: url.split("/files/")[1] }, origin: null })).status).toBe(403);
  });
  it("never serves builds' storage keys in any API payload", async () => {
    const a = await S.tenant("Alpha");
    const { buildId } = await S.validateAndPublish(a);
    const key = (await one<{ r2_object_key: string }>(S.env.DB, "SELECT r2_object_key FROM builds WHERE id = ?", buildId))!.r2_object_key;
    for (const [h, p] of [[build.GET, { buildId }], [validation.GET, { buildId }]] as const) {
      const r = await call(h as never, { cookie: a.adminCookie, params: p as Record<string, string> });
      expect(r.text).not.toContain(key); expect(r.text).not.toContain("r2_object_key");
    }
    const list = await call(pbuilds.GET, { cookie: a.adminCookie, params: { projectId: a.projectId } });
    expect(list.text).not.toContain(key);
  });
  it("records an audit trail for privileged actions", async () => {
    const a = await S.tenant("Alpha");
    const { buildId } = await S.validateAndPublish(a);
    await S.makeLink(a, buildId);
    const actions = (await S.env.DB.prepare("SELECT action FROM audit_logs").all<{ action: string }>()).results.map((r) => r.action);
    for (const x of ["organisation.created", "invitation.accepted", "project.created", "upload.completed", "build.created", "job.claimed", "job.completed", "build.published", "distribution_link.created", "worker.registered"]) expect(actions).toContain(x);
    expect(await one(S.env.DB, "SELECT ip_hash FROM audit_logs WHERE ip_hash IS NOT NULL LIMIT 1")).toBeTruthy();
  });
});
