import { afterEach, describe, expect, it, vi } from "vitest";
import { call, sha256OfBytes } from "../helpers/harness";
import { createScenario, type Tenant } from "../helpers/scenario";
import { enc, macho, plist, simInfo, simZip, tarGz, zip } from "../helpers/archives";
import * as usess from "@/app/api/v1/projects/[projectId]/upload-sessions/route";
import * as upart from "@/app/api/v1/upload-sessions/[sessionId]/parts/[partNumber]/route";
import * as ucomplete from "@/app/api/v1/upload-sessions/[sessionId]/complete/route";
import * as pbuilds from "@/app/api/v1/projects/[projectId]/builds/route";
import * as previewRoute from "@/app/api/v1/builds/[buildId]/preview/route";
import * as retryRoute from "@/app/api/v1/builds/[buildId]/preview/retry/route";
import * as projectPreviews from "@/app/api/v1/projects/[projectId]/previews/route";
import * as links from "@/app/api/v1/builds/[buildId]/distribution-links/route";
import * as revoke from "@/app/api/v1/distribution-links/[linkId]/revoke/route";
import * as publish from "@/app/api/v1/builds/[buildId]/publish/route";
import * as portalBuilds from "@/app/api/v1/portal/builds/route";
import * as files from "@/app/api/v1/files/[token]/route";
import * as settings from "@/app/api/v1/settings/route";
import * as sharing from "@/app/api/v1/builds/[buildId]/preview/sharing/route";
import * as invite from "@/app/api/v1/organisations/[organisationId]/invitations/route";
import * as accept from "@/app/api/v1/auth/accept-invitation/route";
import { cookieFrom } from "../helpers/harness";
import * as pwAccess from "@/app/p/[token]/access/route";
import { one, run } from "@/lib/db";
import { resolveLink, submitLinkPassword } from "@/services/distribution";
import { previewPublicView, runDuePreviews, runPreviewUpload } from "@/services/simulator";
import { pickOsVersion } from "@/lib/appetize";

const TOKEN = "appetize-secret-token-123";
interface Req { method: string; url: string; key: string | null; body: Record<string, unknown> | null }
function mockAppetize(handler: (r: Req) => Response | Promise<Response> = () => Response.json({ publicKey: "pk_demo", versionCode: 1, platform: "ios" })) {
  const calls: Req[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const r: Req = { method: init?.method ?? "GET", url, key: new Headers(init?.headers).get("x-api-key"), body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null };
    calls.push(r);
    return handler(r);
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

async function uploadSim(S: Awaited<ReturnType<typeof createScenario>>, t: Tenant, bytes: Uint8Array, o: { filename?: string; preview?: Record<string, unknown>; cookie?: string } = {}) {
  const cookie = o.cookie ?? t.adminCookie;
  const sha = await sha256OfBytes(bytes);
  const s = await call(usess.POST, { cookie, params: { projectId: t.projectId }, body: { filename: o.filename ?? "App.zip", kind: "simulator", sizeBytes: bytes.length, sha256: sha } });
  if (s.status !== 201) return { s };
  await call(upart.PUT, { cookie, params: { sessionId: s.data.id, partNumber: "1" }, method: "PUT", rawBody: bytes as unknown as BodyInit, headers: { "content-length": String(bytes.length) } });
  const done = await call(ucomplete.POST, { cookie, params: { sessionId: s.data.id } });
  if (done.status !== 200) return { s, done };
  const b = await call(pbuilds.POST, { cookie, params: { projectId: t.projectId }, body: { uploadSessionId: s.data.id, distributionMethod: "simulator_preview", releaseNotes: "Try the new checkout", preview: o.preview } });
  return { s, done, b, S };
}
const previewIdOf = (S: { env: never }, buildId: string) => one<{ id: string }>((S.env as never as { DB: never }).DB, "SELECT id FROM simulator_previews WHERE build_id = ?", buildId).then((r) => r!.id);
const sized = (n: number, seed: number) => simZip(["arm64"], { CFBundleVersion: String(seed) });
void sized; void tarGz;

async function readyBuild(S: Awaited<ReturnType<typeof createScenario>>, t: Tenant, buildNumber = "42") {
  const r = await uploadSim(S, t, simZip(["arm64"], { CFBundleVersion: buildNumber }));
  expect(r.b?.status).toBe(201);
  const buildId = r.b!.data.id as string;
  await runPreviewUpload(S.env, await previewIdOf(S as never, buildId));
  return buildId;
}

describe("simulator preview: upload and Appetize", () => {
  it("accepts a simulator ZIP, uploads it to Appetize by signed URL, and becomes Ready", async () => {
    const S = await createScenario(); S.env.APPETIZE_API_TOKEN = TOKEN; const t = await S.tenant("Sim1");
    const calls = mockAppetize();
    const r = await uploadSim(S, t, simZip(["arm64"]));
    expect(r.b!.status).toBe(201);
    const build = r.b!.data;
    expect(build).toMatchObject({ build_kind: "simulator", bundle_identifier: "com.example.sim", version: "2.0.1", build_number: "42", validation_status: "completed" });
    const id = await previewIdOf(S as never, build.id);
    expect((await call(previewRoute.GET, { cookie: t.adminCookie, params: { buildId: build.id } })).data.status).toBe("pending");

    expect((await runPreviewUpload(S.env, id)).status).toBe("ready");
    expect(calls.length).toBe(1);
    const req = calls[0];
    expect(req.method).toBe("POST"); expect(req.url).toBe("https://api.appetize.io/v1/apps"); expect(req.key).toBe(TOKEN);
    expect(req.body).toMatchObject({ platform: "ios", fileType: "zip", referrerHostnamesRestricted: ["portal.test"], appPermissions: { run: "public" }, disabled: false });
    expect(String(req.body!.url)).toMatch(/^https:\/\/portal\.test\/api\/v1\/files\//);
    // Appetize can really download the archive through that signed URL
    const dl = await call(files.GET, { params: { token: String(req.body!.url).split("/files/")[1] }, origin: null });
    expect(dl.status).toBe(200);

    const pv = await call(previewRoute.GET, { cookie: t.adminCookie, params: { buildId: build.id } });
    expect(pv.data).toMatchObject({ status: "ready", device: "iphone15pro" });
    expect(pv.data.embed_url).toContain("https://appetize.io/embed/pk_demo");
    expect(JSON.stringify(pv.data)).not.toContain(TOKEN);
    expect((await runPreviewUpload(S.env, id)).status).toBe("skipped"); // no double upload
    expect(calls.length).toBe(1);
  });

  it("rejects invalid archives, device IPAs and non-archives with clear messages", async () => {
    const S = await createScenario(); S.env.APPETIZE_API_TOKEN = TOKEN; const t = await S.tenant("Sim2"); mockAppetize();
    const junk = await uploadSim(S, t, enc("this is not a zip file, just some text to upload"));
    expect(junk.done?.status).toBe(422); // rejected as soon as the upload completes
    expect(JSON.stringify(junk.done?.data ?? junk.done?.json ?? junk.done?.text)).toMatch(/not a ZIP, IPA or TAR\.GZ/);

    const ipaZip = zip([{ name: "Payload/App.app/Info.plist", data: enc(plist({ CFBundleIdentifier: "com.x", CFBundleSupportedPlatforms: ["iPhoneOS"] })) }]);
    const asIpa = await uploadSim(S, t, ipaZip, { filename: "Payload.zip" });
    expect(asIpa.b?.status).toBe(422); expect(JSON.stringify(asIpa.b?.data ?? asIpa.b?.json)).toMatch(/device IPA/);

    const named = await call(usess.POST, { cookie: t.adminCookie, params: { projectId: t.projectId }, body: { filename: "App.ipa", kind: "simulator", sizeBytes: 100, sha256: "a".repeat(64) } });
    expect(named.status).toBe(422); expect(JSON.stringify(named.data ?? named.json ?? named.text)).toMatch(/device \.ipa cannot run/);

    const noApp = await uploadSim(S, t, zip([{ name: "readme.txt", data: enc("hello") }]), { filename: "x.zip" });
    expect(noApp.b?.status).toBe(422); expect(JSON.stringify(noApp.b?.data ?? noApp.b?.json)).toMatch(/No \.app bundle/);
    const dev = await uploadSim(S, t, simZip(["arm64"], { CFBundleSupportedPlatforms: ["iPhoneOS"], DTPlatformName: "iphoneos" }), { filename: "dev.zip" });
    expect(dev.b?.status).toBe(422); expect(JSON.stringify(dev.b?.data ?? dev.b?.json)).toMatch(/real device/);
    expect((await one<{ n: number }>(S.env.DB, "SELECT COUNT(*) AS n FROM simulator_previews"))!.n).toBe(0);
  });

  it("accepts a simulator tar.gz", async () => {
    const S = await createScenario(); S.env.APPETIZE_API_TOKEN = TOKEN; const t = await S.tenant("Sim3"); const calls = mockAppetize();
    const r = await uploadSim(S, t, tarGz([{ name: "SimApp.app/Info.plist", data: enc(simInfo()) }, { name: "SimApp.app/SimApp", data: macho(["arm64"]) }]), { filename: "App.tar.gz" });
    expect(r.b?.status).toBe(201);
    await runPreviewUpload(S.env, await previewIdOf(S as never, r.b!.data.id));
    expect(calls[0].body).toMatchObject({ fileType: "tar.gz" });
  });

  it("handles Appetize authentication failure without leaking the token, and recovers after a retry", async () => {
    const S = await createScenario(); S.env.APPETIZE_API_TOKEN = TOKEN; const t = await S.tenant("Sim4");
    const calls = mockAppetize(() => new Response(JSON.stringify({ message: "bad key" }), { status: 401 }));
    const r = await uploadSim(S, t, simZip()); const id = await previewIdOf(S as never, r.b!.data.id);
    expect((await runPreviewUpload(S.env, id)).status).toBe("failed");
    const pv = (await call(previewRoute.GET, { cookie: t.adminCookie, params: { buildId: r.b!.data.id } })).data;
    expect(pv).toMatchObject({ status: "failed", error_code: "AUTH", attempts: 1 });
    expect(pv.status_detail).toMatch(/rejected the API token/); expect(JSON.stringify(pv)).not.toContain(TOKEN);
    expect(calls.length).toBe(1); // 401 is not retried automatically
    expect((await one<{ status_detail: string }>(S.env.DB, "SELECT status_detail FROM simulator_previews WHERE id = ?", id))!.status_detail).not.toContain(TOKEN);

    mockAppetize();
    const retry = await call(retryRoute.POST, { cookie: t.adminCookie, params: { buildId: r.b!.data.id } });
    expect(retry.status).toBe(200); expect(retry.data.status).toBe("ready");
  });

  it("retries transient failures with backoff, and reports a missing token or non-https portal", async () => {
    const S = await createScenario(); S.env.APPETIZE_API_TOKEN = TOKEN; const t = await S.tenant("Sim5");
    let n = 0; mockAppetize(() => (++n === 1 ? new Response("busy", { status: 503 }) : Response.json({ publicKey: "pk_retry", versionCode: 1 })));
    const r = await uploadSim(S, t, simZip()); const id = await previewIdOf(S as never, r.b!.data.id);
    expect((await runPreviewUpload(S.env, id)).status).toBe("pending");
    const row = await one<{ next_attempt_at: string; status_detail: string; attempts: number }>(S.env.DB, "SELECT next_attempt_at, status_detail, attempts FROM simulator_previews WHERE id = ?", id);
    expect(row!.attempts).toBe(1); expect(row!.status_detail).toMatch(/Retrying automatically/); expect(new Date(row!.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    expect((await runPreviewUpload(S.env, id)).status).toBe("skipped"); // not due yet
    await run(S.env.DB, "UPDATE simulator_previews SET next_attempt_at = ? WHERE id = ?", new Date(Date.now() - 1000).toISOString(), id);
    expect(await runDuePreviews(S.env)).toBe(1);
    expect((await one<{ status: string }>(S.env.DB, "SELECT status FROM simulator_previews WHERE id = ?", id))!.status).toBe("ready");

    const t2 = await S.tenant("Sim5b"); S.env.APPETIZE_API_TOKEN = undefined;
    const r2 = await uploadSim(S, t2, simZip(["arm64"], { CFBundleVersion: "7" }));
    await runPreviewUpload(S.env, await previewIdOf(S as never, r2.b!.data.id));
    expect((await call(previewRoute.GET, { cookie: t2.adminCookie, params: { buildId: r2.b!.data.id } })).data).toMatchObject({ status: "failed", error_code: "NOT_CONFIGURED" });
    S.env.APPETIZE_API_TOKEN = TOKEN;
  });

  it("recovers interrupted uploads and survives network errors", async () => {
    const S = await createScenario(); S.env.APPETIZE_API_TOKEN = TOKEN; const t = await S.tenant("Sim6");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down"); }));
    const r = await uploadSim(S, t, simZip()); const id = await previewIdOf(S as never, r.b!.data.id);
    expect((await runPreviewUpload(S.env, id)).status).toBe("pending");
    await run(S.env.DB, "UPDATE simulator_previews SET status = 'processing', updated_at = ? WHERE id = ?", new Date(Date.now() - 3600_000).toISOString(), id);
    mockAppetize(); await runDuePreviews(S.env);
    expect((await one<{ status: string }>(S.env.DB, "SELECT status FROM simulator_previews WHERE id = ?", id))!.status).toBe("ready");
  });
});

describe("simulator preview: versions and history", () => {
  it("keeps every version, blocks duplicates, and can update the same Appetize app", async () => {
    const S = await createScenario(); S.env.APPETIZE_API_TOKEN = TOKEN; const t = await S.tenant("Sim7");
    let keyN = 0; const calls = mockAppetize((r) => (r.url.endsWith("/v1/apps") ? Response.json({ publicKey: `pk_${++keyN}`, versionCode: 1 }) : Response.json({ publicKey: "pk_1", versionCode: 2 })));
    const b1 = await readyBuild(S, t, "1"); const b2 = await readyBuild(S, t, "2");
    expect(b1).not.toBe(b2);
    const dup = await uploadSim(S, t, simZip(["arm64"], { CFBundleVersion: "2" }));
    expect(dup.b?.status).toBe(409); expect(JSON.stringify(dup.b?.data ?? dup.b?.json)).toMatch(/already uploaded/);

    const r3 = await uploadSim(S, t, simZip(["arm64"], { CFBundleVersion: "3" }), { preview: { updateExisting: true } });
    const row3 = await one<{ mode: string; appetize_public_key: string; id: string }>(S.env.DB, "SELECT mode, appetize_public_key, id FROM simulator_previews WHERE build_id = ?", r3.b!.data.id);
    expect(row3!.mode).toBe("update");
    await runPreviewUpload(S.env, row3!.id);
    expect(calls[calls.length - 1].url).toBe(`https://api.appetize.io/v1/apps/${encodeURIComponent(row3!.appetize_public_key)}`);

    const hist = await call(projectPreviews.GET, { cookie: t.adminCookie, params: { projectId: t.projectId } });
    expect(hist.data.items.length).toBe(3);
    expect(hist.data.items.map((i: { build_number: string }) => i.build_number).sort()).toEqual(["1", "2", "3"]);
    expect(hist.data.appetizeConfigured).toBe(true);
    // earlier builds keep their own previews
    expect((await call(previewRoute.GET, { cookie: t.adminCookie, params: { buildId: b1 } })).data.status).toBe("ready");
  });
});

describe("simulator preview: iOS version follows the app's minimum", () => {
  it("picks the oldest Appetize version that satisfies the minimum", () => {
    expect(pickOsVersion("iphone15pro", "16.0")).toBe("17");
    expect(pickOsVersion("iphone15pro", "17.0")).toBe("17");
    expect(pickOsVersion("iphone15pro", "17.5")).toBe("17");
    expect(pickOsVersion("iphone15pro", "18.0")).toBe("18");
    expect(pickOsVersion("iphone16pro", "17.0")).toBe("18");     // no iOS 17 on this device
    expect(pickOsVersion("iphone17pro", "15.0")).toBe("26");
    expect(pickOsVersion("iphone15pro", "99.0")).toBe("27");     // newer than anything offered -> newest
    expect(pickOsVersion("iphone15pro", null)).toBeNull();
    expect(pickOsVersion("iphone15pro", "abc")).toBeNull();
  });

  it("sets the simulator iOS version from the build's minimum iOS and lets staff change it", async () => {
    const S = await createScenario(); S.env.APPETIZE_API_TOKEN = TOKEN; const t = await S.tenant("OsVer"); mockAppetize();
    const r = await uploadSim(S, t, simZip(["arm64"], { MinimumOSVersion: "18.0", CFBundleVersion: "5" })); const buildId = r.b!.data.id as string;
    await runPreviewUpload(S.env, await previewIdOf(S as never, buildId));
    const get = async () => (await call(previewRoute.GET, { cookie: t.adminCookie, params: { buildId } })).data;
    const patch = (body: Record<string, unknown>) => call(previewRoute.PATCH, { cookie: t.adminCookie, method: "PATCH", params: { buildId }, body });
    expect(await get()).toMatchObject({ os_version: "18", os_options: [17, 18, 26, 27] });
    expect((await get()).embed_url).toContain("osVersion=18");
    expect((await patch({ device: "iphone17pro" })).data).toMatchObject({ device: "iphone17pro", os_version: "26" }); // automatically follows the minimum
    expect((await patch({ osVersion: "17" })).status).toBe(422);                                                      // not offered on this device
    expect((await patch({ osVersion: "27" })).data.os_version).toBe("27");
    expect((await patch({ device: "iphone15pro" })).data.os_version).toBe("27");                                       // explicit choice kept when valid
    const latest = await patch({ osVersion: "latest" }); expect(latest.data.os_version).toBeNull();
    expect((await get()).embed_url).not.toContain("osVersion");
    expect((await patch({ osVersion: "min" })).data.os_version).toBe("18");
    const pub = await previewPublicView(S.env, buildId); expect(pub.available && pub.embedUrl).toContain("osVersion=18");
  });
});

describe("simulator preview: display mode", () => {
  it("offers an embed by default and Appetize's hosted player when the plan has no embeds", async () => {
    const S = await createScenario(); S.env.APPETIZE_API_TOKEN = TOKEN; const t = await S.tenant("Disp"); mockAppetize();
    const buildId = await readyBuild(S, t);
    const emb = await previewPublicView(S.env, buildId);
    expect(emb).toMatchObject({ available: true, display: "embed" });
    expect((await call(settings.PUT, { cookie: S.ownerCookie, method: "PUT", body: { previewDisplay: "link" } })).status).toBe(200);
    const link = await previewPublicView(S.env, buildId);
    expect(link).toMatchObject({ available: true, display: "link" });
    if (link.available) expect(link.openUrl).toBe("https://appetize.io/app/pk_demo?device=iphone15pro&osVersion=17");
    expect((await call(previewRoute.GET, { cookie: t.adminCookie, params: { buildId } })).data).toMatchObject({ display: "link", open_url: "https://appetize.io/app/pk_demo?device=iphone15pro&osVersion=17" });
  });
});

describe("simulator preview: client access", () => {
  const linkBody = (over: Record<string, unknown> = {}) => ({ kind: "preview", accessScope: "project_members", userIds: [], allowDownload: false, allowFeedback: true, ...over });
  const tokenOf = (l: { data: { url: string } }) => l.data.url.split("/p/")[1];

  it("only creates preview links once the preview is Ready, and never install links for simulator builds", async () => {
    const S = await createScenario(); S.env.APPETIZE_API_TOKEN = TOKEN; const t = await S.tenant("Sim8"); mockAppetize();
    const r = await uploadSim(S, t, simZip()); const buildId = r.b!.data.id as string;
    expect((await call(links.POST, { cookie: t.adminCookie, params: { buildId }, body: linkBody() })).status).toBe(409);
    await runPreviewUpload(S.env, await previewIdOf(S as never, buildId));
    expect((await call(links.POST, { cookie: t.adminCookie, params: { buildId }, body: linkBody() })).status).toBe(201);
    expect((await call(links.POST, { cookie: t.adminCookie, params: { buildId }, body: linkBody({ kind: "install" }) })).status).toBe(409);
    expect((await call(publish.POST, { cookie: t.adminCookie, params: { buildId } })).status).toBe(409);
  });

  it("enforces member, password, expiry, revoke and disable on the server", async () => {
    const S = await createScenario(); S.env.APPETIZE_API_TOKEN = TOKEN; const t = await S.tenant("Sim9"); const other = await S.tenant("Other9"); const calls = mockAppetize();
    const buildId = await readyBuild(S, t);
    const req = (cookie?: string) => new Request("https://portal.test/p/x", { headers: cookie ? { cookie } : {} });

    // project members only
    const members = await call(links.POST, { cookie: t.adminCookie, params: { buildId }, body: linkBody() });
    const mt = tokenOf(members);
    expect((await resolveLink(S.env, req(), mt)).access).toBe("login_required");
    expect((await resolveLink(S.env, req(t.testerCookie), mt)).access).toBe("granted");
    expect((await resolveLink(S.env, req(other.adminCookie), mt)).access).toBe("denied"); // another organisation's admin
    expect((await resolveLink(S.env, req(other.testerCookie), mt)).access).toBe("denied");
    expect((await resolveLink(S.env, req(t.testerCookie), mt)).link.kind).toBe("preview");

    // password protected (needs the project to allow protected links)
    await run(S.env.DB, "UPDATE projects SET access_policy = 'allow_protected_links' WHERE id = ?", t.projectId);
    const prot = await call(links.POST, { cookie: t.adminCookie, params: { buildId }, body: linkBody({ accessScope: "protected_link", password: "s3cret-pass" }) });
    const pt = tokenOf(prot);
    expect((await resolveLink(S.env, req(), pt)).access).toBe("password_required");
    await expect(submitLinkPassword(S.env, req(), pt, "wrong-pass")).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    const ok = await call(pwAccess.POST, { params: { token: pt }, body: { password: "s3cret-pass" } });
    expect(ok.status).toBe(200);
    const cookie = ok.headers.get("set-cookie")!.split(";")[0];
    expect((await resolveLink(S.env, req(cookie), pt)).access).toBe("granted");
    expect(ok.headers.get("set-cookie")).toContain(`Path=/p/${pt}`);

    // expiry and revocation
    const view = await previewPublicView(S.env, buildId);
    expect(view.available).toBe(true); if (view.available) expect(view.embedUrl).toContain("https://appetize.io/embed/pk_demo");
    await run(S.env.DB, "UPDATE distribution_links SET expires_at = ? WHERE id = ?", new Date(Date.now() - 1000).toISOString(), prot.data.id);
    expect((await resolveLink(S.env, req(cookie), pt)).access).toBe("unavailable");
    expect((await call(revoke.POST, { cookie: t.adminCookie, params: { linkId: members.data.id } })).status).toBe(200);
    expect((await resolveLink(S.env, req(t.testerCookie), mt)).access).toBe("unavailable");

    // disabling the preview also stops it on Appetize
    const off = await call(previewRoute.PATCH, { cookie: t.adminCookie, method: "PATCH", params: { buildId }, body: { enabled: false } });
    expect(off.status).toBe(200); expect(off.data.status).toBe("disabled");
    expect(calls[calls.length - 1].body).toMatchObject({ disabled: true });
    expect(await previewPublicView(S.env, buildId)).toMatchObject({ available: false, reason: expect.stringContaining("turned off") });
    await call(previewRoute.PATCH, { cookie: t.adminCookie, method: "PATCH", params: { buildId }, body: { enabled: true } });
    expect((await previewPublicView(S.env, buildId)).available).toBe(true);

    // preview expiry
    await run(S.env.DB, "UPDATE simulator_previews SET expires_at = ? WHERE build_id = ?", new Date(Date.now() - 1000).toISOString(), buildId);
    expect(await previewPublicView(S.env, buildId)).toMatchObject({ available: false, reason: expect.stringContaining("expired") });
    expect((await call(previewRoute.GET, { cookie: t.adminCookie, params: { buildId } })).data.status).toBe("expired");
    await runDuePreviews(S.env);
    expect(calls[calls.length - 1].body).toMatchObject({ disabled: true });
  });

  async function addTester(t: Tenant, email: string) {
    const inv = await call(invite.POST, { cookie: t.adminCookie, params: { organisationId: t.orgId }, body: { email, role: "qa_tester", projectIds: [t.projectId] } });
    const acc = await call(accept.POST, { body: { token: new URL(inv.data.inviteUrl).searchParams.get("token")!, displayName: email.split("@")[0], password: "tester-password-123" } });
    const id = (await one<{ id: string }>(S_ENV.current!.DB, "SELECT id FROM users WHERE email = ?", email))!.id;
    return { id, cookie: cookieFrom(acc) };
  }
  const S_ENV: { current: { DB: never } | null } = { current: null };

  it("shares a preview only with the members you add; they see it in Available builds as an interactive preview", async () => {
    const S = await createScenario(); S_ENV.current = S.env as never; S.env.APPETIZE_API_TOKEN = TOKEN; const t = await S.tenant("Share1"); const other = await S.tenant("OtherShare"); mockAppetize();
    const second = await addTester(t, "second@share1.test");
    const r = await uploadSim(S, t, simZip()); const buildId = r.b!.data.id as string;
    const list = async (cookie: string) => (await call(portalBuilds.GET, { cookie })).data as { link_kind: string; path: string; build_number: string }[];

    // not shareable until Ready, and nobody sees it by default
    expect((await call(sharing.PUT, { cookie: t.adminCookie, method: "PUT", params: { buildId }, body: { allMembers: false, userIds: [t.testerId] } })).status).toBe(409);
    await runPreviewUpload(S.env, await previewIdOf(S as never, buildId));
    expect((await list(t.testerCookie)).length).toBe(0); expect((await list(second.cookie)).length).toBe(0);
    const state = (await call(sharing.GET, { cookie: t.adminCookie, params: { buildId } })).data;
    expect(state.allMembers).toBe(false); expect(state.members.every((m: { shared: boolean }) => !m.shared)).toBe(true);
    expect(state.members.map((m: { user_id: string }) => m.user_id)).toEqual(expect.arrayContaining([t.testerId, second.id]));

    // add one member
    const put = await call(sharing.PUT, { cookie: t.adminCookie, method: "PUT", params: { buildId }, body: { allMembers: false, userIds: [t.testerId] } });
    expect(put.status).toBe(200); expect(put.data.members.filter((m: { shared: boolean }) => m.shared).map((m: { user_id: string }) => m.user_id)).toEqual([t.testerId]);
    const mine = await list(t.testerCookie);
    expect(mine.length).toBe(1); expect(mine[0]).toMatchObject({ link_kind: "preview", build_number: "42" }); expect(mine[0].path).toMatch(/^\/p\//);
    expect((await list(second.cookie)).length).toBe(0);                         // not added -> not shown
    expect((await list(other.testerCookie)).length).toBe(0);                    // other organisation
    expect((await one<{ n: number }>(S.env.DB, "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'build_published'", t.testerId))!.n).toBe(1);
    // the link itself enforces membership
    const token = mine[0].path.split("/p/")[1];
    expect((await resolveLink(S.env, new Request("https://portal.test/p/x", { headers: { cookie: second.cookie } }), token)).access).toBe("denied");
    expect((await resolveLink(S.env, new Request("https://portal.test/p/x", { headers: { cookie: t.testerCookie } }), token)).access).toBe("granted");

    // add the second, then everyone, then remove people
    await call(sharing.PUT, { cookie: t.adminCookie, method: "PUT", params: { buildId }, body: { allMembers: false, userIds: [t.testerId, second.id] } });
    expect((await list(second.cookie)).length).toBe(1);
    expect((await one<{ n: number }>(S.env.DB, "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'build_published'", t.testerId))!.n).toBe(1); // no duplicate notification
    await call(sharing.PUT, { cookie: t.adminCookie, method: "PUT", params: { buildId }, body: { allMembers: false, userIds: [second.id] } });
    expect((await list(t.testerCookie)).length).toBe(0); expect((await list(second.cookie)).length).toBe(1);
    await call(sharing.PUT, { cookie: t.adminCookie, method: "PUT", params: { buildId }, body: { allMembers: true, userIds: [] } });
    expect((await list(t.testerCookie)).length).toBe(1); expect((await list(second.cookie)).length).toBe(1);
    await call(sharing.PUT, { cookie: t.adminCookie, method: "PUT", params: { buildId }, body: { allMembers: false, userIds: [] } });
    expect((await list(t.testerCookie)).length).toBe(0); expect((await list(second.cookie)).length).toBe(0);
    // turning the preview off also stops it
    await call(sharing.PUT, { cookie: t.adminCookie, method: "PUT", params: { buildId }, body: { allMembers: false, userIds: [t.testerId] } });
    await call(previewRoute.PATCH, { cookie: t.adminCookie, method: "PATCH", params: { buildId }, body: { enabled: false } });
    expect(await previewPublicView(S.env, buildId)).toMatchObject({ available: false });
  });

  it("only lets managers share, and only with real members of this project", async () => {
    const S = await createScenario(); S.env.APPETIZE_API_TOKEN = TOKEN; const t = await S.tenant("Share2"); const other = await S.tenant("OtherShare2"); mockAppetize();
    const buildId = await readyBuild(S, t);
    const body = { allMembers: false, userIds: [t.testerId] };
    expect((await call(sharing.PUT, { cookie: t.testerCookie, method: "PUT", params: { buildId }, body })).status).toBeGreaterThanOrEqual(403);
    expect((await call(sharing.GET, { cookie: t.testerCookie, params: { buildId } })).status).toBeGreaterThanOrEqual(403);
    expect((await call(sharing.PUT, { cookie: other.adminCookie, method: "PUT", params: { buildId }, body })).status).toBe(404);
    expect((await call(sharing.PUT, { params: { buildId }, method: "PUT", body })).status).toBe(401);
    const outsider = await call(sharing.PUT, { cookie: t.adminCookie, method: "PUT", params: { buildId }, body: { allMembers: false, userIds: [other.testerId] } });
    expect(outsider.status).toBe(422);
  });

  it("blocks unauthorised users from uploading, managing or reading another project's previews", async () => {
    const S = await createScenario(); S.env.APPETIZE_API_TOKEN = TOKEN; const t = await S.tenant("Sim11"); const other = await S.tenant("Other11"); mockAppetize();
    const buildId = await readyBuild(S, t);
    // tester: cannot upload, manage or read the staff view
    expect((await uploadSim(S, t, simZip(["arm64"], { CFBundleVersion: "9" }), { cookie: t.testerCookie })).s.status).toBe(403);
    expect((await call(previewRoute.GET, { cookie: t.testerCookie, params: { buildId } })).status).toBeGreaterThanOrEqual(403);
    expect((await call(previewRoute.PATCH, { cookie: t.testerCookie, method: "PATCH", params: { buildId }, body: { enabled: false } })).status).toBeGreaterThanOrEqual(403);
    expect((await call(previewRoute.DELETE, { cookie: t.testerCookie, method: "DELETE", params: { buildId } })).status).toBeGreaterThanOrEqual(403);
    // another organisation's admin cannot see or touch it (404, not 403)
    for (const fn of [() => call(previewRoute.GET, { cookie: other.adminCookie, params: { buildId } }), () => call(retryRoute.POST, { cookie: other.adminCookie, params: { buildId } }), () => call(projectPreviews.GET, { cookie: other.adminCookie, params: { projectId: t.projectId } })])
      expect((await fn()).status).toBe(404);
    // signed out
    expect((await call(previewRoute.GET, { params: { buildId } })).status).toBe(401);
    expect((await call(links.POST, { cookie: other.adminCookie, params: { buildId }, body: linkBody() })).status).toBe(404);
  });

  it("deletes a preview: removes the Appetize app, revokes its links, keeps the build in history", async () => {
    const S = await createScenario(); S.env.APPETIZE_API_TOKEN = TOKEN; const t = await S.tenant("Sim12"); const calls = mockAppetize();
    const buildId = await readyBuild(S, t);
    const l = await call(links.POST, { cookie: t.adminCookie, params: { buildId }, body: linkBody() });
    const del = await call(previewRoute.DELETE, { cookie: t.adminCookie, method: "DELETE", params: { buildId } });
    expect(del.status).toBe(200);
    expect(calls[calls.length - 1]).toMatchObject({ method: "DELETE", url: "https://api.appetize.io/v1/apps/pk_demo", key: TOKEN });
    expect((await resolveLink(S.env, new Request("https://portal.test/p/x"), tokenOf(l))).access).toBe("unavailable");
    expect((await call(previewRoute.GET, { cookie: t.adminCookie, params: { buildId } })).data.status).toBe("deleted");
    expect((await call(projectPreviews.GET, { cookie: t.adminCookie, params: { projectId: t.projectId } })).data.items.length).toBe(1);
  });
});
