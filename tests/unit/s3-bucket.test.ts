import { describe, it, expect, vi, afterEach } from "vitest";
import { S3Bucket } from "../../src/lib/s3-bucket";

/** Minimal in-memory S3 server behind a stubbed fetch, to check the adapter speaks the protocol correctly. */
function fakeS3() {
  const objects = new Map<string, Uint8Array>();
  const uploads = new Map<string, Map<number, Uint8Array>>();
  const calls: { method: string; url: string; auth: string | null }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as RequestInfo, init);
    const u = new URL(req.url);
    calls.push({ method: req.method, url: req.url, auth: req.headers.get("authorization") });
    const key = decodeURIComponent(u.pathname.replace(/^\/storage\/v1\/s3\/ipa\//, ""));
    const body = new Uint8Array(await req.arrayBuffer());
    if (req.method === "POST" && u.searchParams.has("uploads")) { const id = "up-" + uploads.size; uploads.set(id, new Map()); return new Response(`<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`); }
    if (req.method === "PUT" && u.searchParams.has("partNumber")) { const n = Number(u.searchParams.get("partNumber")); uploads.get(u.searchParams.get("uploadId")!)!.set(n, body); return new Response(null, { headers: { etag: `"e${n}"` } }); }
    if (req.method === "POST" && u.searchParams.has("uploadId")) {
      const parts = uploads.get(u.searchParams.get("uploadId")!)!; const order = [...new TextDecoder().decode(body).matchAll(/<PartNumber>(\d+)<\/PartNumber>/g)].map((m) => Number(m[1]));
      const chunks = order.map((n) => parts.get(n)!); const out = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0)); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
      objects.set(key, out); return new Response("<CompleteMultipartUploadResult/>");
    }
    if (req.method === "DELETE" && u.searchParams.has("uploadId")) { uploads.delete(u.searchParams.get("uploadId")!); return new Response(null, { status: 204 }); }
    if (req.method === "PUT") { objects.set(key, body); return new Response(null); }
    if (req.method === "DELETE") { objects.delete(key); return new Response(null, { status: 204 }); }
    const o = objects.get(key);
    if (!o) return new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
    if (req.method === "HEAD") return new Response(null, { headers: { "content-length": String(o.length) } });
    const r = /^bytes=(\d+)-(\d+)$/.exec(req.headers.get("range") ?? "");
    const slice = r ? o.slice(Number(r[1]), Number(r[2]) + 1) : o;
    return new Response(slice as unknown as BodyInit, { status: r ? 206 : 200, headers: { "content-length": String(slice.length) } });
  });
  return { fn, objects, calls };
}

describe("S3Bucket adapter", () => {
  afterEach(() => vi.unstubAllGlobals());
  const mk = () => new S3Bucket({ endpoint: "https://x.supabase.co/storage/v1/s3", region: "ap-south-1", bucket: "ipa", accessKeyId: "AK", secretAccessKey: "SK" });

  it("puts, heads, ranges, gets and deletes with signed requests", async () => {
    const s3 = fakeS3(); vi.stubGlobal("fetch", s3.fn);
    const b = mk();
    await b.put("a/b c.json", JSON.stringify({ ok: 1 }), { httpMetadata: { contentType: "application/json" } });
    expect(await b.head("a/b c.json")).toEqual({ key: "a/b c.json", size: 8 });
    expect(await b.head("nope")).toBeNull();
    expect(await b.get("nope")).toBeNull();
    const r = await b.get("a/b c.json", { range: { offset: 1, length: 3 } });
    expect(new TextDecoder().decode(await r!.arrayBuffer())).toBe('"ok');
    await b.delete("a/b c.json");
    expect(await b.head("a/b c.json")).toBeNull();
    expect(s3.calls.every((c) => c.auth?.startsWith("AWS4-HMAC-SHA256"))).toBe(true);
  });

  it("assembles a multipart upload (parts out of order) and can abort", async () => {
    const s3 = fakeS3(); vi.stubGlobal("fetch", s3.fn);
    const b = mk();
    const mp = await b.createMultipartUpload("k/app.ipa");
    const p2 = await mp.uploadPart(2, new Uint8Array([4, 5]).buffer);
    const p1 = await b.resumeMultipartUpload("k/app.ipa", mp.uploadId).uploadPart(1, new Response(new Uint8Array([1, 2, 3])).body!);
    await b.resumeMultipartUpload("k/app.ipa", mp.uploadId).complete([p2, p1]);
    expect([...s3.objects.get("k/app.ipa")!]).toEqual([1, 2, 3, 4, 5]);
    const mp2 = await b.createMultipartUpload("k/x"); await mp2.abort();
    expect(s3.objects.has("k/x")).toBe(false);
  });
});
