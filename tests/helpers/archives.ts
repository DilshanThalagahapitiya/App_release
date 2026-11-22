import { deflateRawSync, gzipSync } from "node:zlib";

export const enc = (s: string) => new TextEncoder().encode(s);
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
const w32 = (v: number) => new Uint8Array([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]);
const w16 = (v: number) => new Uint8Array([v & 255, (v >> 8) & 255]);

/** Minimal ZIP writer (CRCs are not checked by our reader). */
export function zip(files: { name: string; data: Uint8Array; deflate?: boolean }[]): Uint8Array {
  const parts: Uint8Array[] = []; const central: Uint8Array[] = []; let off = 0;
  for (const f of files) {
    const name = enc(f.name); const body = f.deflate === false ? f.data : new Uint8Array(deflateRawSync(f.data)); const m = f.deflate === false ? 0 : 8;
    const local = cat(w32(0x04034b50), w16(20), w16(0), w16(m), w16(0), w16(0), w32(0), w32(body.length), w32(f.data.length), w16(name.length), w16(0), name, body);
    central.push(cat(w32(0x02014b50), w16(20), w16(20), w16(0), w16(m), w16(0), w16(0), w32(0), w32(body.length), w32(f.data.length), w16(name.length), w16(0), w16(0), w16(0), w16(0), w32(0), w32(off), name));
    parts.push(local); off += local.length;
  }
  const cd = cat(...central);
  return cat(...parts, cd, w32(0x06054b50), w16(0), w16(0), w16(files.length), w16(files.length), w32(cd.length), w32(off), w16(0));
}

/** Minimal ustar writer, gzip'd. */
export function tarGz(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const f of files) {
    const h = new Uint8Array(512); h.set(enc(f.name).subarray(0, 100), 0); h.set(enc("0000644\0"), 100); h.set(enc("0000000\0"), 108); h.set(enc("0000000\0"), 116);
    h.set(enc(f.data.length.toString(8).padStart(11, "0") + "\0"), 124); h.set(enc("00000000000\0"), 136); h.set(enc("        "), 148); h[156] = 48; h.set(enc("ustar\0"), 257); h.set(enc("00"), 263);
    let sum = 0; for (const b of h) sum += b; h.set(enc(sum.toString(8).padStart(6, "0") + "\0 "), 148);
    blocks.push(h, f.data, new Uint8Array((512 - (f.data.length % 512)) % 512));
  }
  blocks.push(new Uint8Array(1024));
  return new Uint8Array(gzipSync(cat(...blocks)));
}

/** Thin or fat Mach-O header with the given CPU types (enough for architecture detection). */
export function macho(archs: ("arm64" | "x86_64")[]): Uint8Array {
  const cpu = { arm64: 0x0100000c, x86_64: 0x01000007 };
  if (archs.length === 1) { const h = new Uint8Array(32); h.set([0xcf, 0xfa, 0xed, 0xfe], 0); h.set(w32(cpu[archs[0]]), 4); return h; }
  const be = (v: number) => new Uint8Array([(v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
  const h = new Uint8Array(8 + archs.length * 20 + 32); h.set([0xca, 0xfe, 0xba, 0xbe], 0); h.set(be(archs.length), 4);
  archs.forEach((a, i) => h.set(be(cpu[a]), 8 + i * 20)); return h;
}

export const plist = (o: Record<string, string | string[]>) =>
  `<?xml version="1.0"?><plist><dict>${Object.entries(o).map(([k, v]) => `<key>${k}</key>${Array.isArray(v) ? `<array>${v.map((x) => `<string>${x}</string>`).join("")}</array>` : `<string>${v}</string>`}`).join("")}</dict></plist>`;

export const simInfo = (over: Record<string, string | string[]> = {}) => plist({ CFBundleIdentifier: "com.example.sim", CFBundleName: "SimApp", CFBundleDisplayName: "Sim App", CFBundleShortVersionString: "2.0.1", CFBundleVersion: "42", CFBundleExecutable: "SimApp", MinimumOSVersion: "16.0", CFBundleSupportedPlatforms: ["iPhoneSimulator"], DTPlatformName: "iphonesimulator", ...over });

export const simZip = (archs: ("arm64" | "x86_64")[] = ["arm64"], infoOver: Record<string, string | string[]> = {}) =>
  zip([{ name: "SimApp.app/Info.plist", data: enc(simInfo(infoOver)) }, { name: "SimApp.app/SimApp", data: macho(archs) }, { name: "SimApp.app/_CodeSignature/CodeResources", data: enc("x") }]);
