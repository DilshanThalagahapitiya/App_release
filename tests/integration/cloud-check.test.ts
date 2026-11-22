import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { call, sha256OfBytes } from "../helpers/harness";
import { createScenario } from "../helpers/scenario";
import * as settings from "@/app/api/v1/settings/route";
import * as publish from "@/app/api/v1/builds/[buildId]/publish/route";
import * as build from "@/app/api/v1/builds/[buildId]/route";
import * as reval from "@/app/api/v1/builds/[buildId]/revalidate/route";
import { resolveLink, publicView } from "@/services/distribution";

function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = []; const central: Uint8Array[] = []; let off = 0;
  const w32 = (v: number) => new Uint8Array([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]);
  const w16 = (v: number) => new Uint8Array([v & 255, (v >> 8) & 255]);
  const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
  for (const f of files) {
    const name = new TextEncoder().encode(f.name); const body = new Uint8Array(deflateRawSync(f.data));
    const local = cat(w32(0x04034b50), w16(20), w16(0), w16(8), w16(0), w16(0), w32(0), w32(body.length), w32(f.data.length), w16(name.length), w16(0), name, body);
    central.push(cat(w32(0x02014b50), w16(20), w16(20), w16(0), w16(8), w16(0), w16(0), w32(0), w32(body.length), w32(f.data.length), w16(name.length), w16(0), w16(0), w16(0), w16(0), w32(0), w32(off), name));
    parts.push(local); off += local.length;
  }
  const cd = cat(...central);
  return cat(...parts, cd, w32(0x06054b50), w16(0), w16(0), w16(files.length), w16(files.length), w32(cd.length), w32(off), w16(0));
}
const enc = (s: string) => new TextEncoder().encode(s);
const info = (id: string) => enc(`<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleShortVersionString</key><string>3.4.5</string><key>CFBundleVersion</key><string>99</string><key>CFBundleName</key><string>Cloud App</string><key>MinimumOSVersion</key><string>16.0</string></dict></plist>`);
const prov = (exp: string) => enc(`\x01junk<?xml version="1.0"?><plist><dict><key>Name</key><string>AdHoc</string><key>UUID</key><string>U1</string><key>TeamIdentifier</key><array><string>TEAM123456</string></array><key>CreationDate</key><date>2026-01-01T00:00:00Z</date><key>ExpirationDate</key><date>${exp}</date><key>ProvisionedDevices</key><array><string>AAAA-1</string><string>BBBB-2</string></array><key>Entitlements</key><dict><key>application-identifier</key><string>TEAM123456.com.example.mock</string><key>get-task-allow</key><false/></dict></dict></plist>\x02`);
const goodIpa = () => zip([
  { name: "Payload/Cloud.app/Info.plist", data: info("com.example.mock") },
  { name: "Payload/Cloud.app/embedded.mobileprovision", data: prov("2099-01-01T00:00:00Z") },
  { name: "Payload/Cloud.app/_CodeSignature/CodeResources", data: enc("x") },
]);

describe("validation mode CLOUD", () => {
  it("reads the IPA in the cloud, fills metadata + devices, and allows publish/install without any worker", async () => {
    const S = await createScenario(); const t = await S.tenant("Cloudy");
    expect((await call(settings.PUT, { cookie: S.ownerCookie, body: { validationMode: "cloud" } })).status).toBe(200);
    const { buildId } = await S.uploadBuild(t, goodIpa());
    const b = await call(build.GET, { cookie: t.adminCookie, params: { buildId } });
    expect(b.data).toMatchObject({ validation_status: "completed", eligibility_status: "eligible_with_warnings", bundle_identifier: "com.example.mock", version: "3.4.5", build_number: "99", app_name: "Cloud App" });
    expect(b.data.validation.profile).toMatchObject({ profileType: "ad_hoc", deviceCount: 2, devices: ["AAAA-1", "BBBB-2"], teamIdentifier: "TEAM123456", appIdMatchesBundle: true });
    expect(b.data.validation.signing.verification).toBe("unknown");
    expect(JSON.stringify(b.data.validation.warnings)).toContain("not verified");
    expect(await S.claimJob()).toBeNull();
    expect((await call(publish.POST, { cookie: t.adminCookie, params: { buildId } })).status).toBe(200);
    const l = await S.makeLink(t, buildId);
    const r = await resolveLink(S.env, new Request("https://portal.test/d/x", { headers: { cookie: t.testerCookie } }), l.data.url.split("/d/")[1]);
    expect((await publicView(S.env, r)).action.kind).toBe("ota");
  });

  it("marks an expired profile or a missing signature as not eligible, and a non-IPA as failed", async () => {
    const S = await createScenario(); const t = await S.tenant("Cloudy2");
    await call(settings.PUT, { cookie: S.ownerCookie, body: { validationMode: "cloud" } });
    const expired = zip([{ name: "Payload/A.app/Info.plist", data: info("com.example.mock") }, { name: "Payload/A.app/embedded.mobileprovision", data: prov("2020-01-01T00:00:00Z") }, { name: "Payload/A.app/_CodeSignature/CodeResources", data: enc("x") }]);
    const e = await S.uploadBuild(t, expired);
    expect((await call(build.GET, { cookie: t.adminCookie, params: { buildId: e.buildId } })).data.eligibility_status).toBe("not_eligible");
    const unsigned = zip([{ name: "Payload/A.app/Info.plist", data: info("com.example.mock") }, { name: "Payload/A.app/embedded.mobileprovision", data: prov("2099-01-01T00:00:00Z") }]);
    const u = await S.uploadBuild(t, unsigned);
    expect((await call(build.GET, { cookie: t.adminCookie, params: { buildId: u.buildId } })).data.eligibility_status).toBe("not_eligible");
    const junk = await S.uploadBuild(t); // test fixture bytes: not a real archive
    const j = await call(build.GET, { cookie: t.adminCookie, params: { buildId: junk.buildId } });
    expect(j.data.validation_status).toBe("failed");
    expect(j.data.eligibility_status).toBe("not_eligible");
  });

  it("re-validate re-runs the cloud check instead of queueing a Mac job", async () => {
    const S = await createScenario(); const t = await S.tenant("Cloudy3");
    await call(settings.PUT, { cookie: S.ownerCookie, body: { validationMode: "cloud" } });
    const { buildId } = await S.uploadBuild(t, goodIpa());
    const r = await call(reval.POST, { cookie: t.adminCookie, params: { buildId } });
    expect(r.status).toBe(200);
    expect(await S.claimJob()).toBeNull();
    void sha256OfBytes;
  });
});
