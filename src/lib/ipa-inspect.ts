/**
 * "Cloud check": inspects an IPA entirely inside the Worker (no Mac). It reads the ZIP directory with a few range
 * requests, then extracts and parses Info.plist and embedded.mobileprovision.
 *
 * It does NOT verify the code signature cryptographically (that needs Apple's macOS tools); it only notices whether
 * a signature is present. That limit is written into every report it produces.
 */

export interface ByteSource {
  size(): Promise<number>;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export const bytesSource = (b: Uint8Array): ByteSource => ({ size: async () => b.length, read: async (o, l) => b.slice(o, o + l) });

const MAX_ENTRY_BYTES = 16 * 1024 * 1024; // Info.plist / profile are tiny; anything bigger is refused
const MAX_CENTRAL_DIR = 32 * 1024 * 1024;

export class IpaInspectError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

// ---------------------------------------------------------------- ZIP
interface ZipEntry { name: string; method: number; compSize: number; size: number; offset: number }
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export async function readZipDirectory(src: ByteSource): Promise<ZipEntry[]> {
  const size = await src.size();
  if (size < 22) throw new IpaInspectError("IPA_NOT_ZIP", "The file is too small to be a ZIP archive.");
  const tailLen = Math.min(size, 65557);
  const tail = await src.read(size - tailLen, tailLen);
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 5 && tail[i + 3] === 6) { e = i; break; }
  if (e < 0) throw new IpaInspectError("IPA_NOT_ZIP", "The file is not a valid ZIP/IPA archive (no end-of-directory record).");
  const total = u16(tail, e + 10); const cdSize = u32(tail, e + 12); const cdOffset = u32(tail, e + 16);
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff || total === 0xffff) throw new IpaInspectError("IPA_UNSUPPORTED", "ZIP64 archives are not supported by the cloud check.");
  if (cdSize > MAX_CENTRAL_DIR || cdOffset + cdSize > size) throw new IpaInspectError("IPA_NOT_ZIP", "The ZIP directory is invalid.");
  const cd = await src.read(cdOffset, cdSize);
  const out: ZipEntry[] = []; const dec = new TextDecoder();
  for (let p = 0; p + 46 <= cd.length && out.length < 200000;) {
    if (u32(cd, p) !== 0x02014b50) break;
    const nameLen = u16(cd, p + 28), extraLen = u16(cd, p + 30), commentLen = u16(cd, p + 32);
    out.push({ method: u16(cd, p + 10), compSize: u32(cd, p + 20), size: u32(cd, p + 24), offset: u32(cd, p + 42), name: dec.decode(cd.subarray(p + 46, p + 46 + nameLen)) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (!out.length) throw new IpaInspectError("IPA_NOT_ZIP", "The ZIP archive is empty.");
  return out;
}

async function inflateRaw(b: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const w = ds.writable.getWriter();
  void w.write(b as unknown as BufferSource).catch(() => undefined);
  void w.close().catch(() => undefined);
  const r = ds.readable.getReader(); const chunks: Uint8Array[] = []; let n = 0;
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    n += value.length;
    if (n > MAX_ENTRY_BYTES) { await r.cancel(); throw new IpaInspectError("IPA_UNSUPPORTED", "A file inside the IPA is unexpectedly large."); }
    chunks.push(value);
  }
  const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export async function readZipEntry(src: ByteSource, e: ZipEntry): Promise<Uint8Array> {
  if (e.size > MAX_ENTRY_BYTES || e.compSize > MAX_ENTRY_BYTES) throw new IpaInspectError("IPA_UNSUPPORTED", `${e.name} is too large to inspect.`);
  const lh = await src.read(e.offset, 30);
  if (u32(lh, 0) !== 0x04034b50) throw new IpaInspectError("IPA_NOT_ZIP", "A ZIP entry header is corrupt.");
  const start = e.offset + 30 + u16(lh, 26) + u16(lh, 28);
  const data = await src.read(start, e.compSize);
  if (e.method === 0) return data;
  if (e.method === 8) return inflateRaw(data);
  throw new IpaInspectError("IPA_UNSUPPORTED", `Unsupported ZIP compression method ${e.method}.`);
}

// ---------------------------------------------------------------- plist
export type PlistValue = string | number | boolean | null | Date | Uint8Array | PlistValue[] | { [k: string]: PlistValue };
type Dict = { [k: string]: PlistValue };

const unescapeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");

export function parseXmlPlist(text: string): PlistValue {
  const re = /<(\/?)([A-Za-z]+)([^>]*?)(\/?)>([^<]*)/g;
  type Frame = { kind: "dict" | "array"; dict: Dict; arr: PlistValue[]; key: string | null };
  const stack: Frame[] = []; let root: PlistValue | undefined; let pendingKey = false; let leaf: { name: string; text: string } | null = null;
  const put = (v: PlistValue) => {
    const top = stack[stack.length - 1];
    if (!top) { if (root === undefined) root = v; return; }
    if (top.kind === "array") top.arr.push(v); else if (top.key !== null) { top.dict[top.key] = v; top.key = null; }
  };
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const [, closing, name, , selfClose, trailing] = m;
    if (name === "plist") continue;
    if (closing) {
      if (name === "dict" || name === "array") { const f = stack.pop()!; put(f.kind === "dict" ? f.dict : f.arr); }
      else if (name === "key") { const top = stack[stack.length - 1]; if (top) top.key = leaf?.text ?? ""; leaf = null; pendingKey = false; }
      else if (leaf && leaf.name === name) {
        const t = leaf.text; leaf = null;
        if (name === "string") put(unescapeXml(t)); else if (name === "integer") put(Number(t.trim())); else if (name === "real") put(Number(t.trim()));
        else if (name === "date") put(new Date(t.trim())); else if (name === "data") put(Uint8Array.from(atob(t.replace(/\s+/g, "")), (c) => c.charCodeAt(0)));
      }
      continue;
    }
    if (name === "dict" || name === "array") {
      if (selfClose) { put(name === "dict" ? {} : []); continue; }
      if (stack.length > 64) throw new IpaInspectError("IPA_UNSUPPORTED", "Plist nesting is too deep.");
      stack.push({ kind: name, dict: {}, arr: [], key: null }); continue;
    }
    if (name === "true" || name === "false") { put(name === "true"); continue; }
    if (selfClose) { put(name === "string" ? "" : null); continue; }
    if (name === "key") { pendingKey = true; leaf = { name: "key", text: unescapeXml(trailing) }; continue; }
    leaf = { name, text: trailing };
  }
  void pendingKey;
  if (root === undefined) throw new IpaInspectError("IPA_BAD_PLIST", "The property list is empty or unreadable.");
  return root;
}

export function parseBinaryPlist(b: Uint8Array): PlistValue {
  if (b.length < 40 || String.fromCharCode(...b.subarray(0, 8)) !== "bplist00") throw new IpaInspectError("IPA_BAD_PLIST", "Not a binary property list.");
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const t = b.length - 32;
  const offSize = b[t + 6], refSize = b[t + 7];
  const numObjs = Number(dv.getBigUint64(t + 8)); const top = Number(dv.getBigUint64(t + 16)); const tableOff = Number(dv.getBigUint64(t + 24));
  if (!offSize || !refSize || offSize > 8 || refSize > 8 || numObjs > 1_000_000 || tableOff + numObjs * offSize > t) throw new IpaInspectError("IPA_BAD_PLIST", "Corrupt binary property list.");
  const readInt = (o: number, n: number) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[o + i]; return v; };
  const offsetOf = (i: number) => { if (i >= numObjs) throw new IpaInspectError("IPA_BAD_PLIST", "Bad object reference."); return readInt(tableOff + i * offSize, offSize); };
  let budget = numObjs * 4 + 1000;
  const lenAt = (o: number): [number, number] => {
    const low = b[o] & 0x0f; if (low !== 0x0f) return [low, o + 1];
    const mk = b[o + 1]; const n = 1 << (mk & 0x0f); return [readInt(o + 2, n), o + 2 + n];
  };
  const obj = (i: number, depth: number): PlistValue => {
    if (depth > 64 || budget-- <= 0) throw new IpaInspectError("IPA_BAD_PLIST", "Property list is too complex.");
    const o = offsetOf(i); const type = b[o] >> 4; const low = b[o] & 0x0f;
    switch (type) {
      case 0x0: return low === 0x8 ? false : low === 0x9 ? true : null;
      case 0x1: { const n = 1 << low; return n <= 8 ? readInt(o + 1, n) : 0; }
      case 0x2: return low === 2 ? dv.getFloat32(o + 1) : dv.getFloat64(o + 1);
      case 0x3: return new Date(Date.UTC(2001, 0, 1) + dv.getFloat64(o + 1) * 1000);
      case 0x4: { const [n, p] = lenAt(o); return b.slice(p, p + n); }
      case 0x5: { const [n, p] = lenAt(o); return String.fromCharCode(...b.subarray(p, p + n)); }
      case 0x6: { const [n, p] = lenAt(o); let s = ""; for (let k = 0; k < n; k++) s += String.fromCharCode((b[p + 2 * k] << 8) | b[p + 2 * k + 1]); return s; }
      case 0x8: return readInt(o + 1, low + 1);
      case 0xa: { const [n, p] = lenAt(o); const a: PlistValue[] = []; for (let k = 0; k < n; k++) a.push(obj(readInt(p + k * refSize, refSize), depth + 1)); return a; }
      case 0xd: {
        const [n, p] = lenAt(o); const d: Dict = {};
        for (let k = 0; k < n; k++) { const key = obj(readInt(p + k * refSize, refSize), depth + 1); d[String(key)] = obj(readInt(p + (n + k) * refSize, refSize), depth + 1); }
        return d;
      }
      default: return null;
    }
  };
  return obj(top, 0);
}

export function parsePlist(b: Uint8Array): PlistValue {
  if (b.length > 8 && b[0] === 0x62 && b[1] === 0x70 && b[2] === 0x6c) return parseBinaryPlist(b);
  return parseXmlPlist(new TextDecoder().decode(b));
}

/** embedded.mobileprovision is a CMS envelope whose payload is a plain XML plist; extract it without verifying the CMS. */
export function parseMobileProvision(b: Uint8Array): Dict {
  const s = new TextDecoder("utf-8").decode(b);
  const a = s.indexOf("<?xml"); const z = s.lastIndexOf("</plist>");
  if (a < 0 || z < 0) throw new IpaInspectError("IPA_BAD_PROFILE", "The embedded provisioning profile could not be read.");
  const v = parseXmlPlist(s.slice(a, z + 8));
  if (!v || typeof v !== "object" || Array.isArray(v) || v instanceof Date || v instanceof Uint8Array) throw new IpaInspectError("IPA_BAD_PROFILE", "The embedded provisioning profile is malformed.");
  return v as Dict;
}

// ---------------------------------------------------------------- report
const str = (v: PlistValue | undefined): string | null => (typeof v === "string" ? v : null);
const iso = (v: PlistValue | undefined): string | null => (v instanceof Date && !isNaN(v.getTime()) ? v.toISOString().replace(/\.\d+Z$/, "Z") : null);
const asDict = (v: PlistValue | undefined): Dict => (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof Uint8Array) ? (v as Dict) : {});

export interface CloudInspection {
  app: { name: string | null; bundleIdentifier: string | null; version: string | null; buildNumber: string | null; minimumOSVersion: string | null; deviceFamilies: number[]; architectures: string[] };
  signaturePresent: boolean;
  provisioning: {
    present: boolean; profileType: "development" | "ad_hoc" | "enterprise" | "app_store" | "unknown" | "none"; name: string | null; uuid: string | null; teamIdentifier: string | null;
    applicationIdentifier: string | null; createdAt: string | null; expiresAt: string | null; expired: boolean | undefined; deviceRegistrationRequired: boolean;
    deviceCount: number | null; devices: string[] | null; appIdMatchesBundle: boolean | null;
  };
  entitlements: { applicationIdentifier: string | null; getTaskAllow: boolean | null; apsEnvironment: string | null; associatedDomainsCount: number; keys: string[] };
  notes: string[];
}

export async function inspectIpaSource(src: ByteSource, now = new Date()): Promise<CloudInspection> {
  const entries = await readZipDirectory(src);
  const infoRe = /^Payload\/([^/]+\.app)\/Info\.plist$/;
  const infoEntry = entries.find((e) => infoRe.test(e.name));
  if (!infoEntry) throw new IpaInspectError("IPA_NO_APP", "No app bundle (Payload/<name>.app/Info.plist) was found. Is this an iOS IPA?");
  const appDir = `Payload/${infoRe.exec(infoEntry.name)![1]}/`;
  const info = asDict(parsePlist(await readZipEntry(src, infoEntry)));
  const bundleId = str(info.CFBundleIdentifier);
  if (!bundleId) throw new IpaInspectError("IPA_NO_BUNDLE_ID", "No bundle identifier could be read from Info.plist.");
  const notes: string[] = [];
  const families = Array.isArray(info.UIDeviceFamily) ? (info.UIDeviceFamily.filter((x) => typeof x === "number") as number[]) : [];
  const app = { name: str(info.CFBundleDisplayName) ?? str(info.CFBundleName), bundleIdentifier: bundleId, version: str(info.CFBundleShortVersionString), buildNumber: str(info.CFBundleVersion), minimumOSVersion: str(info.MinimumOSVersion), deviceFamilies: families, architectures: [] as string[] };
  const signaturePresent = entries.some((e) => e.name === `${appDir}_CodeSignature/CodeResources`);

  const provEntry = entries.find((e) => e.name === `${appDir}embedded.mobileprovision`);
  let prov: Dict | null = null;
  if (provEntry) { try { prov = parseMobileProvision(await readZipEntry(src, provEntry)); } catch (e) { notes.push((e as Error).message); } }

  const ent = asDict(prov?.Entitlements);
  const devices = Array.isArray(prov?.ProvisionedDevices) ? [...new Set((prov!.ProvisionedDevices as PlistValue[]).filter((d): d is string => typeof d === "string"))].sort().slice(0, 5000) : null;
  const teams = Array.isArray(prov?.TeamIdentifier) ? prov!.TeamIdentifier : [];
  const team = typeof teams[0] === "string" ? (teams[0] as string) : null;
  const appId = str(ent["application-identifier"]);
  const getTaskAllow = typeof ent["get-task-allow"] === "boolean" ? (ent["get-task-allow"] as boolean) : null;
  let profileType: CloudInspection["provisioning"]["profileType"] = "none";
  if (prov) profileType = prov.ProvisionsAllDevices === true ? "enterprise" : devices ? (getTaskAllow === true ? "development" : "ad_hoc") : getTaskAllow === true ? "development" : "app_store";
  const exp = prov?.ExpirationDate instanceof Date ? prov.ExpirationDate : null;
  let matches: boolean | null = null;
  if (appId && team) { const suffix = appId.startsWith(team + ".") ? appId.slice(team.length + 1) : appId; matches = suffix === "*" || suffix === bundleId || (suffix.endsWith("*") && bundleId.startsWith(suffix.slice(0, -1))); }
  const domains = ent["com.apple.developer.associated-domains"];
  return {
    app, signaturePresent, notes,
    provisioning: {
      present: !!prov, profileType, name: str(prov?.Name), uuid: str(prov?.UUID), teamIdentifier: team, applicationIdentifier: appId,
      createdAt: iso(prov?.CreationDate), expiresAt: iso(prov?.ExpirationDate), expired: exp ? exp.getTime() < now.getTime() : undefined,
      deviceRegistrationRequired: !!devices, deviceCount: devices ? devices.length : null, devices, appIdMatchesBundle: matches,
    },
    entitlements: { applicationIdentifier: appId, getTaskAllow, apsEnvironment: str(ent["aps-environment"]), associatedDomainsCount: Array.isArray(domains) ? domains.length : 0, keys: Object.keys(ent).sort() },
  };
}

/** Convenience wrapper: inspect an object in the storage bucket. Returns null when the file is not a readable IPA. */
export async function inspectIpa(env: { BUCKET: R2Bucket }, key: string) {
  const head = await env.BUCKET.head(key);
  if (!head) return null;
  const src: ByteSource = {
    size: async () => head.size,
    read: async (offset, length) => {
      const o = await env.BUCKET.get(key, { range: { offset, length } });
      if (!o) throw new IpaInspectError("IPA_MISSING", "The uploaded IPA could not be read from storage.");
      return new Uint8Array(await o.arrayBuffer());
    },
  };
  try {
    const r = await inspectIpaSource(src);
    return { app: { name: r.app.name, bundleIdentifier: r.app.bundleIdentifier, version: r.app.version, buildNumber: r.app.buildNumber, minimumOSVersion: r.app.minimumOSVersion }, profile: r.provisioning, signaturePresent: r.signaturePresent };
  } catch (e) {
    if (e instanceof IpaInspectError) return null;
    throw e;
  }
}
