/**
 * Packs a dropped/selected .app folder into a ZIP in the browser, so developers can drag the app straight from Finder
 * without compressing it first. Self-contained (no dependencies): CRC-32 + native deflate (CompressionStream).
 *
 * Browsers do not expose Unix permissions, so any Mach-O binary (the app's executable, frameworks, dylibs) is stored
 * with mode 0755 and everything else 0644; otherwise the unzipped app could not be launched.
 */
export interface PackFile { path: string; file: Blob; mtime?: number }

const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(b: Uint8Array): number { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export function isMachO(b: Uint8Array): boolean {
  if (b.length < 4) return false;
  const m = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  return m === 0xcffaedfe || m === 0xcefaedfe || m === 0xfeedfacf || m === 0xfeedface || m === 0xcafebabe || m === 0xbebafeca;
}

async function deflateRaw(b: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate-raw");
  const w = cs.writable.getWriter(); void w.write(b as unknown as BufferSource); void w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

const u16 = (v: number) => new Uint8Array([v & 255, (v >> 8) & 255]);
const u32 = (v: number) => new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]);
function dos(ms: number) { const d = new Date(ms); const y = Math.max(1980, d.getFullYear()); return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }; }

export async function buildZip(files: PackFile[], onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const enc = new TextEncoder(); const parts: BlobPart[] = []; const central: Uint8Array[] = []; let offset = 0; let done = 0;
  const total = files.reduce((n, f) => n + f.file.size, 0) || 1; let doneBytes = 0;
  for (const f of files) {
    const data = new Uint8Array(await f.file.arrayBuffer());
    const crc = crc32(data); const exec = isMachO(data);
    let body: Uint8Array = data; let method = 0;
    if (data.length >= 64) { const c = await deflateRaw(data); if (c.length < data.length) { body = c; method = 8; } }
    const name = enc.encode(f.path); const t = dos(f.mtime ?? Date.now());
    const local: Uint8Array[] = [u32(0x04034b50), u16(20), u16(0x0800), u16(method), u16(t.time), u16(t.date), u32(crc), u32(body.length), u32(data.length), u16(name.length), u16(0), name];
    for (const p of local) parts.push(p as unknown as BlobPart); parts.push(body as unknown as BlobPart);
    const hdr = local.reduce((n, x) => n + x.length, 0);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16((3 << 8) | 20), ...u16(20), ...u16(0x0800), ...u16(method), ...u16(t.time), ...u16(t.date), ...u32(crc), ...u32(body.length), ...u32(data.length),
      ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(((exec ? 0o100755 : 0o100644) << 16) >>> 0), ...u32(offset), ...name]));
    offset += hdr + body.length; done++; doneBytes += data.length; onProgress?.(doneBytes, total);
  }
  const cdSize = central.reduce((n, x) => n + x.length, 0);
  for (const c of central) parts.push(c as unknown as BlobPart);
  parts.push(new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(done), ...u16(done), ...u32(cdSize), ...u32(offset), ...u16(0)]) as unknown as BlobPart);
  return new Blob(parts, { type: "application/zip" });
}

// ---------------------------------------------------------------- reading a dropped folder
interface FsEntry { isFile: boolean; isDirectory: boolean; name: string; fullPath: string; file?: (ok: (f: File) => void, err: (e: unknown) => void) => void; createReader?: () => { readEntries: (ok: (e: FsEntry[]) => void, err: (e: unknown) => void) => void } }
const SKIP = new Set([".DS_Store"]);

async function readAll(dir: FsEntry): Promise<FsEntry[]> {
  const reader = dir.createReader!(); const out: FsEntry[] = [];
  for (;;) { const batch = await new Promise<FsEntry[]>((ok, err) => reader.readEntries(ok, err)); if (!batch.length) break; out.push(...batch); }
  return out;
}
async function walk(dir: FsEntry, base: string, out: PackFile[]) {
  for (const e of await readAll(dir)) {
    if (SKIP.has(e.name)) continue;
    if (e.isDirectory) await walk(e, `${base}${e.name}/`, out);
    else if (e.isFile) { const file = await new Promise<File>((ok, err) => e.file!(ok, err)); out.push({ path: `${base}${e.name}`, file, mtime: file.lastModified }); }
  }
}

/** Finds the .app in a dropped directory (the .app itself, or a folder like Debug-iphonesimulator that holds exactly one). */
export async function collectApp(root: unknown): Promise<{ name: string; files: PackFile[] } | { error: string }> {
  const dir = root as FsEntry;
  if (!dir?.isDirectory) return { error: "Drop the .app folder (or a .zip)." };
  let app = dir;
  if (!dir.name.endsWith(".app")) {
    const apps = (await readAll(dir)).filter((e) => e.isDirectory && e.name.endsWith(".app"));
    if (apps.length !== 1) return { error: apps.length ? "That folder holds several .app folders. Drop the one you want." : "No .app folder found. Drop the .app folder itself, for example CredeQIAudit.app." };
    app = apps[0];
  }
  const files: PackFile[] = []; await walk(app, `${app.name}/`, files);
  if (!files.some((f) => f.path === `${app.name}/Info.plist`)) return { error: `${app.name} has no Info.plist. Is this really an app folder?` };
  return { name: app.name.slice(0, -4), files };
}

/** From a folder chosen with <input webkitdirectory>. */
export function appFromFileList(list: FileList): { name: string; files: PackFile[] } | { error: string } {
  const all = Array.from(list).filter((f) => !SKIP.has(f.name)).map((f) => ({ path: (f as File & { webkitRelativePath: string }).webkitRelativePath || f.name, file: f as Blob, mtime: f.lastModified }));
  const rootName = all[0]?.path.split("/")[0] ?? "";
  if (!rootName.endsWith(".app")) return { error: "Choose the .app folder itself, for example CredeQIAudit.app." };
  if (!all.some((f) => f.path === `${rootName}/Info.plist`)) return { error: `${rootName} has no Info.plist. Is this really an app folder?` };
  return { name: rootName.slice(0, -4), files: all };
}

export async function packApp(app: { name: string; files: PackFile[] }, onProgress?: (done: number, total: number) => void): Promise<File> {
  const blob = await buildZip(app.files, onProgress);
  return new File([blob], `${app.name}.zip`, { type: "application/zip" });
}
