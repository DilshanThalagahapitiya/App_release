import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { inspectIpa } from "../../src/lib/ipa-inspect";

/** Builds a minimal ZIP (CRCs are not checked by the inspector). */
function zip(files: { name: string; data: Uint8Array; deflate?: boolean }[]): Uint8Array {
  const parts: Uint8Array[] = []; const central: Uint8Array[] = []; let off = 0;
  const w32 = (v: number) => new Uint8Array([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]);
  const w16 = (v: number) => new Uint8Array([v & 255, (v >> 8) & 255]);
  const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
  for (const f of files) {
    const name = new TextEncoder().encode(f.name); const body = f.deflate ? new Uint8Array(deflateRawSync(f.data)) : f.data; const m = f.deflate ? 8 : 0;
    const local = cat(w32(0x04034b50), w16(20), w16(0), w16(m), w16(0), w16(0), w32(0), w32(body.length), w32(f.data.length), w16(name.length), w16(0), name, body);
    central.push(cat(w32(0x02014b50), w16(20), w16(20), w16(0), w16(m), w16(0), w16(0), w32(0), w32(body.length), w32(f.data.length), w16(name.length), w16(0), w16(0), w16(0), w16(0), w32(0), w32(off), name));
    parts.push(local); off += local.length;
  }
  const cd = cat(...central);
  return cat(...parts, cd, w32(0x06054b50), w16(0), w16(0), w16(files.length), w16(files.length), w32(cd.length), w32(off), w16(0));
}
const bucketOf = (bytes: Uint8Array) => ({ BUCKET: {
  head: async () => ({ size: bytes.length }),
  get: async (_k: string, o?: { range?: { offset: number; length: number } }) => { const s = o?.range ? bytes.slice(o.range.offset, o.range.offset + o.range.length) : bytes; return { arrayBuffer: async () => s.buffer.slice(s.byteOffset, s.byteOffset + s.byteLength) }; },
} }) as never;
const enc = (s: string) => new TextEncoder().encode(s);

const info = `<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>com.acme.app</string><key>CFBundleShortVersionString</key><string>2.1.0</string><key>CFBundleVersion</key><string>77</string><key>CFBundleDisplayName</key><string>Acme &amp; Co</string><key>MinimumOSVersion</key><string>16.0</string></dict></plist>`;
const prov = (extra: string, exp: string) => `\u0001\u0002junk<?xml version="1.0"?><plist><dict><key>Name</key><string>Acme AdHoc</string><key>UUID</key><string>U-1</string><key>TeamIdentifier</key><array><string>TEAM123456</string></array><key>CreationDate</key><date>2026-01-01T00:00:00Z</date><key>ExpirationDate</key><date>${exp}</date>${extra}<key>Entitlements</key><dict><key>application-identifier</key><string>TEAM123456.com.acme.app</string><key>get-task-allow</key><false/></dict></dict></plist>\u0003trailer`;

describe("inspectIpa", () => {
  it("reads app facts and an Ad Hoc profile with its devices", async () => {
    const z = zip([
      { name: "Payload/Acme.app/Info.plist", data: enc(info), deflate: true },
      { name: "Payload/Acme.app/embedded.mobileprovision", data: enc(prov("<key>ProvisionedDevices</key><array><string>B-2</string><string>A-1</string></array>", "2099-01-01T00:00:00Z")), deflate: true },
      { name: "Payload/Acme.app/Acme", data: enc("binary") },
    ]);
    const r = await inspectIpa(bucketOf(z), "k");
    expect(r?.app).toEqual({ name: "Acme & Co", bundleIdentifier: "com.acme.app", version: "2.1.0", buildNumber: "77", minimumOSVersion: "16.0" });
    expect(r?.profile).toMatchObject({ profileType: "ad_hoc", devices: ["A-1", "B-2"], expired: false, teamIdentifier: "TEAM123456", applicationIdentifier: "TEAM123456.com.acme.app" });
  });
  it("flags an expired profile and App Store style profiles", async () => {
    const mk = (extra: string, exp: string) => zip([{ name: "Payload/A.app/Info.plist", data: enc(info) }, { name: "Payload/A.app/embedded.mobileprovision", data: enc(prov(extra, exp)) }]);
    expect((await inspectIpa(bucketOf(mk("<key>ProvisionedDevices</key><array/>", "2020-01-01T00:00:00Z")), "k"))?.profile?.expired).toBe(true);
    expect((await inspectIpa(bucketOf(mk("", "2099-01-01T00:00:00Z")), "k"))?.profile?.profileType).toBe("app_store");
  });
  it("returns null for non-zips and zips without an app", async () => {
    expect(await inspectIpa(bucketOf(enc("not a zip at all, just text")), "k")).toBeNull();
    expect(await inspectIpa(bucketOf(zip([{ name: "readme.txt", data: enc("x") }])), "k")).toBeNull();
  });
});
