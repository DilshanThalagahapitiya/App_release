/** In-memory R2 fake supporting the subset of the binding the app uses (incl. multipart). */
type Obj = { data: Uint8Array; meta?: unknown };
async function toBytes(v: unknown): Promise<Uint8Array> {
  if (v instanceof Uint8Array) return v;
  if (typeof v === "string") return new TextEncoder().encode(v);
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (v && typeof (v as ReadableStream).getReader === "function") return new Uint8Array(await new Response(v as ReadableStream).arrayBuffer());
  throw new Error("unsupported body");
}
export function createR2() {
  const store = new Map<string, Obj>();
  const uploads = new Map<string, { key: string; parts: Map<number, Uint8Array> }>();
  const mkBody = (d: Uint8Array) => new Response(d as unknown as BodyInit).body!;
  const wrap = (key: string, o: Obj, range?: { offset: number; length: number }) => {
    const d = range ? o.data.slice(range.offset, range.offset + range.length) : o.data;
    return { key, size: d.byteLength, body: mkBody(d), arrayBuffer: async () => d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) };
  };
  const bucket = {
    _store: store,
    async put(key: string, v: unknown, meta?: unknown) { store.set(key, { data: await toBytes(v), meta }); return { key }; },
    async get(key: string, opts?: { range?: { offset: number; length: number } }) { const o = store.get(key); return o ? wrap(key, o, opts?.range) : null; },
    async head(key: string) { const o = store.get(key); return o ? { key, size: o.data.byteLength } : null; },
    async delete(key: string) { store.delete(key); },
    async createMultipartUpload(key: string) {
      const uploadId = crypto.randomUUID(); uploads.set(uploadId, { key, parts: new Map() });
      return bucket.resumeMultipartUpload(key, uploadId);
    },
    resumeMultipartUpload(key: string, uploadId: string) {
      return {
        key, uploadId,
        async uploadPart(n: number, body: unknown) { const u = uploads.get(uploadId)!; u.parts.set(n, await toBytes(body)); return { partNumber: n, etag: `etag-${n}-${u.parts.get(n)!.byteLength}` }; },
        async abort() { uploads.delete(uploadId); },
        async complete(parts: { partNumber: number; etag: string }[]) {
          const u = uploads.get(uploadId); if (!u) throw new Error("no such upload");
          const chunks = parts.map((p) => { const d = u.parts.get(p.partNumber); if (!d || p.etag !== `etag-${p.partNumber}-${d.byteLength}`) throw new Error("bad part"); return d; });
          const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0)); let o = 0; for (const c of chunks) { out.set(c, o); o += c.byteLength; }
          store.set(key, { data: out }); uploads.delete(uploadId); return { key };
        },
      };
    },
  };
  return bucket as unknown as R2Bucket & { _store: Map<string, Obj> };
}
