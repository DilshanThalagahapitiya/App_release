// Live smoke test against a running instance (wrangler dev / preview / staging). NOT for production data.
//   BASE=http://127.0.0.1:8799 OWNER_EMAIL=... OWNER_PASSWORD=... node scripts/smoke.mjs
// Uses a synthetic ZIP-magic file and a clearly labelled MOCK worker report: it exercises the platform's plumbing
// (multipart upload, checksum verification in the Workers runtime, job leasing, publish, links, pages) — not IPA analysis.
import { createHash, randomBytes } from "node:crypto";
const BASE = process.env.BASE ?? "http://127.0.0.1:8799";
const ORIGIN = process.env.ORIGIN ?? "http://localhost:3000";
let cookie = "";
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } console.log("ok  ", m); };
async function api(path, { method = "POST", body, headers = {}, raw, auth = true } = {}) {
  const h = { origin: ORIGIN, ...headers };
  if (auth && cookie) h.cookie = cookie;
  if (body !== undefined) h["content-type"] = "application/json";
  const r = await fetch(BASE + path, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined), redirect: "manual" });
  const sc = r.headers.getSetCookie?.() ?? []; const s = sc.find((x) => x.startsWith("ipa_session=")); if (s) cookie = s.split(";")[0];
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, data: j?.data, error: j?.error, text: t, headers: r.headers };
}
const sfx = randomBytes(3).toString("hex");
let r = await api("/api/v1/auth/login", { body: { email: process.env.OWNER_EMAIL ?? "owner@example.com", password: process.env.OWNER_PASSWORD ?? "local-dev-password-123" } });
ok(r.status === 200, "owner sign-in");
r = await api("/api/v1/organisations", { body: { name: `Smoke ${sfx}`, adminEmail: `admin-${sfx}@smoke.test` } });
ok(r.status === 201, "organisation + admin invitation");
const inviteToken = new URL(r.data.invitation.inviteUrl).searchParams.get("token");
const ownerCookie = cookie; cookie = "";
r = await api("/api/v1/auth/accept-invitation", { body: { token: inviteToken, displayName: "Smoke Admin", password: "smoke-admin-password" } });
ok(r.status === 200 && cookie, "admin accepts invitation (single use)");
r = await api("/api/v1/auth/accept-invitation", { body: { token: inviteToken, displayName: "x", password: "smoke-admin-password" } });
ok(r.status === 409, "invitation token cannot be reused");
r = await api("/api/v1/projects", { body: { name: "Smoke App", expected_bundle_identifier: "com.smoke.app" } });
ok(r.status === 201, "project created"); const projectId = r.data.id;
const size = 40 * 1024 * 1024; const bytes = Buffer.alloc(size, 7); bytes.set([0x50, 0x4b, 3, 4]);
const sha = createHash("sha256").update(bytes).digest("hex");
r = await api(`/api/v1/projects/${projectId}/upload-sessions`, { body: { filename: "Smoke.ipa", sizeBytes: size, sha256: sha } });
ok(r.status === 201 && r.data.totalParts === 2, "multipart upload session (2 parts)"); const sid = r.data.id; const part = r.data.partSizeBytes;
for (let n = 1; n <= 2; n++) {
  const chunk = bytes.subarray((n - 1) * part, Math.min(size, n * part));
  r = await api(`/api/v1/upload-sessions/${sid}/parts/${n}`, { method: "PUT", raw: chunk, headers: { "content-length": String(chunk.length) } });
  ok(r.status === 200, `part ${n} uploaded`);
}
r = await api(`/api/v1/upload-sessions/${sid}/complete`);
ok(r.status === 200 && r.data.verified, "server verified size + SHA-256 (DigestStream)");
r = await api(`/api/v1/projects/${projectId}/builds`, { body: { uploadSessionId: sid, releaseTitle: "Smoke", distributionMethod: "determine_from_ipa" } });
ok(r.status === 201, "build + job queued"); const buildId = r.data.id;
r = await api(`/api/v1/builds/${buildId}/publish`);
ok(r.status === 409, "cannot publish before validation");
// register worker (owner) and run the lease protocol with a MOCK report
const adminCookie = cookie; cookie = ownerCookie;
r = await api("/api/v1/workers", { body: { name: `smoke-${sfx}` } }); const wtoken = r.data.token; ok(!!wtoken, "worker registered (token shown once)");
cookie = "";
const W = { authorization: `Bearer ${wtoken}` };
r = await api("/api/v1/worker/jobs/claim", { body: {}, headers: W, auth: false }); ok(r.status === 200 && r.data.job?.buildId === buildId, "worker claimed the job atomically");
const job = r.data.job;
const dl = await fetch(job.downloadUrl.replace(/^https?:\/\/[^/]+/, BASE)); const got = Buffer.from(await dl.arrayBuffer());
ok(dl.status === 200 && createHash("sha256").update(got).digest("hex") === sha, "signed download URL streams the exact bytes");
r = await api("/api/v1/worker/jobs/" + job.jobId + "/started", { body: { leaseToken: job.leaseToken }, headers: W, auth: false }); ok(r.status === 200, "job started");
r = await api("/api/v1/worker/jobs/" + job.jobId + "/started", { body: { leaseToken: "x".repeat(24) }, headers: W, auth: false }); ok(r.status === 409, "wrong lease token rejected");
const report = { schemaVersion: 1, overallStatus: "completed", eligibilityStatus: "eligible", file: { sizeBytes: size, sha256: sha }, app: { name: "Smoke", bundleIdentifier: "com.smoke.app", version: "1.0", buildNumber: "1", minimumOSVersion: "16.0", deviceFamilies: [1], architectures: ["arm64"] }, signing: { verification: "valid", identitySummary: "MOCK FIXTURE" }, provisioning: { present: true, profileType: "ad_hoc", expired: false, expiresAt: new Date(Date.now() + 9e9).toISOString(), appIdMatchesBundle: true, deviceCount: 1, deviceRegistrationRequired: true }, entitlements: {}, checks: [{ code: "MOCK", status: "passed", message: "mock fixture" }], warnings: [], errors: [], limitations: ["MOCK worker report from scripts/smoke.mjs"] };
r = await api("/api/v1/worker/jobs/" + job.jobId + "/complete", { body: { leaseToken: job.leaseToken, report }, headers: W, auth: false }); ok(r.status === 200, "report validated + stored");
r = await api("/api/v1/worker/jobs/" + job.jobId + "/complete", { body: { leaseToken: job.leaseToken, report }, headers: W, auth: false }); ok(r.status === 200 && r.data.replay, "replayed completion is an idempotent no-op");
cookie = adminCookie;
r = await api(`/api/v1/builds/${buildId}`, { method: "GET" }); ok(r.data.validation_status === "completed" && !("r2_object_key" in r.data), "build validated; no storage key exposed");
r = await api(`/api/v1/builds/${buildId}/publish`); ok(r.status === 200, "published");
r = await api(`/api/v1/builds/${buildId}/distribution-links`, { body: { accessScope: "project_members", userIds: [], allowDownload: true, allowFeedback: true } }); ok(r.status === 201, "distribution link created"); const link = r.data;
const tok = link.url.split("/d/")[1];
const png = await fetch(`${BASE}/api/v1/distribution-links/${link.id}/qr?format=png`, { headers: { cookie } }); const pb = Buffer.from(await png.arrayBuffer());
ok(png.status === 200 && pb.subarray(1, 4).toString() === "PNG", "QR PNG generated");
const svg = await api(`/api/v1/distribution-links/${link.id}/qr?format=svg`, { method: "GET" }); ok(svg.text.startsWith("<svg"), "QR SVG generated");
let page = await fetch(`${BASE}/d/${tok}`); let html = await page.text(); ok(page.status === 200 && /Sign in to continue/.test(html), "anonymous visitor to member-only link is asked to sign in");
page = await fetch(`${BASE}/d/${tok}`, { headers: { cookie } }); html = await page.text(); ok(/itms-services/.test(html) && !/r2_object_key/.test(html), "staff preview shows OTA install action");
const m = html.match(/manifest\.plist%3Fa%3D([^"&]+)/); const grant = decodeURIComponent(decodeURIComponent(m?.[1] ?? ""));
const man = await fetch(`${BASE}/d/${tok}/manifest.plist?a=${encodeURIComponent(grant)}`); const mt = await man.text(); ok(man.status === 200 && mt.includes("com.smoke.app"), "OTA manifest generated from validated metadata");
const noGrant = await fetch(`${BASE}/d/${tok}/manifest.plist`); ok(noGrant.status === 403 || noGrant.status === 401, "manifest requires an access grant");
r = await api(`/api/v1/distribution-links/${link.id}/revoke`); ok(r.status === 200, "link revoked");
page = await fetch(`${BASE}/d/${tok}`); html = await page.text(); ok(/revoked/i.test(html), "revoked link shows generic unavailable page");
r = await api(`/api/v1/distribution-links/${link.id}/qr`, { method: "GET" }); ok(r.status === 409, "QR unavailable after revocation");
for (const p of ["/app", "/app/projects", `/app/builds/${buildId}`, "/portal", "/auth/login"]) { const x = await fetch(BASE + p, { headers: { cookie }, redirect: "manual" }); ok(x.status === 200, `page renders: ${p}`); }
const anon = await fetch(BASE + "/app", { redirect: "manual" }); ok(anon.status >= 300 && anon.status < 400, "anonymous /app redirects to sign-in");
console.log("\nSMOKE TEST PASSED");
