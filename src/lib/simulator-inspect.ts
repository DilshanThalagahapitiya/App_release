import { bytesSource, IpaInspectError, parsePlist, readZipDirectory, readZipEntry, type ByteSource, type PlistValue } from "./ipa-inspect";

/**
 * Validates an iOS *Simulator* build (a zipped or tar.gz'd .app folder) before it is sent to Appetize.
 * ZIPs are read with a few range requests. TAR.GZ has no index, so it is streamed and only the first
 * TGZ_SCAN_LIMIT bytes (decompressed) are scanned; if the app's Info.plist is not found by then the
 * archive is accepted with a warning and Appetize does the final validation.
 */
export class SimulatorInspectError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export interface SimulatorInspection {
  fileType: "zip" | "tar.gz";
  app: { name: string | null; bundleIdentifier: string | null; version: string | null; buildNumber: string | null; minimumOSVersion: string | null };
  architectures: string[];
  warnings: string[];
  fullyInspected: boolean;
}

const TGZ_SCAN_LIMIT = 24 * 1024 * 1024;
const HOW = "Build for the Simulator (xcodebuild -sdk iphonesimulator) and zip the .app folder: zip -r MyApp.zip MyApp.app";
const dict = (v: PlistValue | undefined): Record<string, PlistValue> => (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof Uint8Array) ? (v as Record<string, PlistValue>) : {});
const str = (v: PlistValue | undefined) => (typeof v === "string" ? v : null);

export function detectArchiveKind(head: Uint8Array): "zip" | "tar.gz" | null {
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && (head[2] === 3 || head[2] === 5)) return "zip";
  if (head.length >= 3 && head[0] === 0x1f && head[1] === 0x8b && head[2] === 8) return "tar.gz";
  return null;
}

/** CPU types from a Mach-O (thin or fat) header. */
export function machoArchitectures(h: Uint8Array): string[] {
  if (h.length < 8) return [];
  const be = (o: number) => ((h[o] << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) >>> 0;
  const le = (o: number) => (h[o] | (h[o + 1] << 8) | (h[o + 2] << 16) | (h[o + 3] << 24)) >>> 0;
  const name = (cpu: number) => (cpu === 0x0100000c ? "arm64" : cpu === 0x01000007 ? "x86_64" : cpu === 0x0c ? "arm" : cpu === 7 ? "i386" : `cpu${cpu}`);
  if (be(0) === 0xcafebabe) { const n = Math.min(be(4), 8); const out: string[] = []; for (let i = 0; i < n && 8 + i * 20 + 4 <= h.length; i++) out.push(name(be(8 + i * 20))); return out; }
  if (le(0) === 0xfeedfacf || le(0) === 0xfeedface) return [name(le(4))];
  return [];
}

function readAppFacts(info: Record<string, PlistValue>, warnings: string[]) {
  const platforms = Array.isArray(info.CFBundleSupportedPlatforms) ? info.CFBundleSupportedPlatforms.filter((x): x is string => typeof x === "string") : [];
  const dtPlatform = str(info.DTPlatformName);
  const isSim = platforms.includes("iPhoneSimulator") || dtPlatform === "iphonesimulator";
  const isDevice = platforms.includes("iPhoneOS") || dtPlatform === "iphoneos";
  if (!isSim && (isDevice || platforms.length)) throw new SimulatorInspectError("SIM_DEVICE_BUILD", `This .app was built for a real device, not the iOS Simulator, so it cannot run in a browser preview. ${HOW}`);
  if (!isSim) warnings.push("The app's Info.plist does not say which platform it was built for; Appetize will check it.");
  const bundleIdentifier = str(info.CFBundleIdentifier);
  if (!bundleIdentifier) throw new SimulatorInspectError("SIM_NO_BUNDLE_ID", "No bundle identifier could be read from the app's Info.plist.");
  return { name: str(info.CFBundleDisplayName) ?? str(info.CFBundleName), bundleIdentifier, version: str(info.CFBundleShortVersionString), buildNumber: str(info.CFBundleVersion), minimumOSVersion: str(info.MinimumOSVersion), exec: str(info.CFBundleExecutable) };
}

function archWarnings(archs: string[], warnings: string[]) {
  if (archs.length && !archs.includes("arm64") && !archs.includes("x86_64")) throw new SimulatorInspectError("SIM_BAD_ARCH", `The app has no arm64 or x86_64 simulator code (found: ${archs.join(", ")}). Rebuild for the iOS Simulator.`);
  if (archs.length && !archs.includes("arm64")) warnings.push("This build has no Apple Silicon (arm64) slice. Appetize recommends arm64 simulator builds, so it may not run.");
}

// ---------------------------------------------------------------- ZIP
async function zipHead(src: ByteSource, offset: number, compSize: number, method: number, want: number): Promise<Uint8Array> {
  const lh = await src.read(offset, 30);
  const start = offset + 30 + (lh[26] | (lh[27] << 8)) + (lh[28] | (lh[29] << 8));
  if (method === 0) return src.read(start, Math.min(compSize, want));
  const comp = await src.read(start, Math.min(compSize, 512 * 1024));
  const ds = new DecompressionStream("deflate-raw");
  const w = ds.writable.getWriter(); void w.write(comp as unknown as BufferSource).catch(() => undefined); void w.close().catch(() => undefined);
  const r = ds.readable.getReader(); const chunks: Uint8Array[] = []; let n = 0;
  try { while (n < want) { const { done, value } = await r.read(); if (done) break; chunks.push(value); n += value.length; } } catch { /* truncated input is expected */ }
  const out = new Uint8Array(Math.min(n, want)); let o = 0; for (const c of chunks) { const take = Math.min(c.length, out.length - o); out.set(c.subarray(0, take), o); o += take; if (o >= out.length) break; }
  return out;
}

export async function inspectSimulatorZip(src: ByteSource): Promise<SimulatorInspection> {
  let entries;
  try { entries = await readZipDirectory(src); } catch (e) { throw new SimulatorInspectError("SIM_NOT_ARCHIVE", e instanceof IpaInspectError ? e.message : "The file is not a valid ZIP archive."); }
  if (entries.some((e) => /^Payload\/[^/]+\.app\//.test(e.name)))
    throw new SimulatorInspectError("SIM_IS_IPA", `This is a device IPA (it contains a Payload folder). Appetize cannot run device builds. ${HOW}`);
  const infoRe = /^(?:[^/]+\/)?([^/]+\.app)\/Info\.plist$/;
  const infoEntry = entries.find((e) => infoRe.test(e.name) && !e.name.startsWith("__MACOSX/"));
  if (!infoEntry) throw new SimulatorInspectError("SIM_NO_APP", `No .app bundle was found in the archive. The .app folder itself must be inside the ZIP. ${HOW}`);
  const prefix = infoEntry.name.slice(0, infoEntry.name.length - "Info.plist".length);
  const warnings: string[] = [];
  const info = dict(parsePlist(await readZipEntry(src, infoEntry)));
  const facts = readAppFacts(info, warnings);
  let architectures: string[] = [];
  const exec = entries.find((e) => e.name === prefix + (facts.exec ?? ""));
  if (exec) { try { architectures = machoArchitectures(await zipHead(src, exec.offset, exec.compSize, exec.method, 4096)); } catch { /* optional */ } }
  archWarnings(architectures, warnings);
  if (!architectures.length) warnings.push("The app's CPU architecture could not be read; Appetize will check it.");
  const { exec: _e, ...app } = facts; void _e;
  return { fileType: "zip", app, architectures, warnings, fullyInspected: true };
}

// ---------------------------------------------------------------- TAR.GZ (streamed, bounded)
export async function inspectSimulatorTarGz(open: () => Promise<ReadableStream<Uint8Array>>): Promise<SimulatorInspection> {
  const ds = new DecompressionStream("gzip");
  const reader = (await open()).pipeThrough(ds as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
  let buf = new Uint8Array(0); let consumed = 0; let ended = false;
  const need = async (n: number): Promise<boolean> => {
    while (buf.length < n) {
      if (ended) return false;
      let chunk;
      try { chunk = await reader.read(); } catch { throw new SimulatorInspectError("SIM_NOT_ARCHIVE", "The file is not a valid .tar.gz archive."); }
      if (chunk.done) { ended = true; return buf.length >= n; }
      const nb = new Uint8Array(buf.length + chunk.value.length); nb.set(buf); nb.set(chunk.value, buf.length); buf = nb;
    }
    return true;
  };
  const take = (n: number) => { const out = buf.subarray(0, n); buf = buf.subarray(n); consumed += n; return out; };
  const skip = async (n: number) => { while (n > 0) { if (!(await need(1))) return; const k = Math.min(n, buf.length); take(k); n -= k; } };
  const dec = new TextDecoder();
  const oct = (b: Uint8Array) => parseInt(dec.decode(b).replace(/\0.*$/, "").trim() || "0", 8);
  const infoRe = /^(?:\.\/)?(?:[^/]+\/)?([^/]+\.app)\/Info\.plist$/;
  let info: Record<string, PlistValue> | null = null; let prefix = ""; let sawPayload = false; let longName: string | null = null; const warnings: string[] = []; let architectures: string[] = []; let execWanted: string | null = null;
  try {
    while (consumed < TGZ_SCAN_LIMIT && (await need(512))) {
      const h = take(512);
      if (h.every((x) => x === 0)) break;
      let name = longName ?? dec.decode(h.subarray(0, 100)).replace(/\0.*$/, ""); longName = null;
      const prefixField = dec.decode(h.subarray(345, 500)).replace(/\0.*$/, "");
      if (prefixField && !name.startsWith(prefixField)) name = prefixField + "/" + name;
      const size = oct(h.subarray(124, 136)); const type = String.fromCharCode(h[156] || 48); const padded = Math.ceil(size / 512) * 512;
      if (type === "L" && size < 4096) { if (!(await need(padded))) break; longName = dec.decode(take(padded).subarray(0, size)).replace(/\0.*$/, ""); continue; }
      if (type === "x" && size < 8192) { if (!(await need(padded))) break; const m = /\d+ path=([^\n]+)\n/.exec(dec.decode(take(padded).subarray(0, size))); if (m) longName = m[1]; continue; }
      if (/^(?:\.\/)?Payload\/[^/]+\.app\//.test(name)) sawPayload = true;
      if (!info && infoRe.test(name) && !name.startsWith("__MACOSX/") && size < 2 * 1024 * 1024) {
        if (!(await need(padded))) break;
        info = dict(parsePlist(take(padded).slice(0, size))); prefix = name.slice(0, name.length - "Info.plist".length);
        execWanted = prefix + (str(info.CFBundleExecutable) ?? ""); continue;
      }
      if (execWanted && name === execWanted && size >= 8) { if (!(await need(Math.min(padded, 4096)))) break; architectures = machoArchitectures(buf.subarray(0, 4096)); await skip(padded); execWanted = null; if (info) break; continue; }
      await skip(padded);
      if (info && !execWanted) break;
    }
  } finally { try { await reader.cancel(); } catch { /* ignore */ } }
  if (sawPayload) throw new SimulatorInspectError("SIM_IS_IPA", `This is a device IPA (it contains a Payload folder). Appetize cannot run device builds. ${HOW}`);
  if (!info) {
    if (consumed >= TGZ_SCAN_LIMIT) return { fileType: "tar.gz", app: { name: null, bundleIdentifier: null, version: null, buildNumber: null, minimumOSVersion: null }, architectures: [], warnings: ["The app's details could not be read from this large .tar.gz, so Appetize will validate it. Use a .zip for a full pre-check."], fullyInspected: false };
    throw new SimulatorInspectError("SIM_NO_APP", `No .app bundle was found in the archive. The .app folder itself must be inside the archive. ${HOW}`);
  }
  const facts = readAppFacts(info, warnings);
  archWarnings(architectures, warnings);
  if (!architectures.length) warnings.push("The app's CPU architecture could not be read from the first part of the archive; Appetize will check it.");
  const { exec: _e, ...app } = facts; void _e;
  return { fileType: "tar.gz", app, architectures, warnings, fullyInspected: true };
}

export { bytesSource };
