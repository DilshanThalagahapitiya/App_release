import { AwsClient } from "aws4fetch";

/**
 * R2Bucket-compatible adapter over any S3-compatible object store (Supabase Storage, MinIO, AWS S3…).
 * Implements ONLY the subset of the R2 binding this app uses: put/get/head/delete and multipart upload.
 * Used when STORAGE_S3_* settings are present, so deployments need no Cloudflare R2.
 */
export interface S3Config { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string }

type Body = string | ArrayBuffer | ArrayBufferView | ReadableStream;
const enc = encodeURIComponent;
const xmlText = (xml: string, tag: string) => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1];

async function toBuffer(v: Body): Promise<ArrayBuffer | string> {
  if (typeof v === "string") return v;
  if (v instanceof ArrayBuffer) return v;
  if (ArrayBuffer.isView(v)) return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer;
  return new Response(v as ReadableStream).arrayBuffer();
}

export class S3Bucket {
  private aws: AwsClient;
  private base: string;
  constructor(private cfg: S3Config) {
    this.aws = new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, service: "s3", region: cfg.region, retries: 3 });
    this.base = `${cfg.endpoint.replace(/\/+$/, "")}/${enc(cfg.bucket)}`;
  }
  private url(key: string, query = "") { return `${this.base}/${key.split("/").map(enc).join("/")}${query}`; }
  private async call(url: string, init: RequestInit & { headers?: Record<string, string> }, okStatuses: number[] = [200, 204]): Promise<Response> {
    const res = await this.aws.fetch(url, init);
    if (!okStatuses.includes(res.status)) {
      const text = await res.text().catch(() => "");
      throw Object.assign(new Error(`Storage ${init.method ?? "GET"} failed (${res.status}) ${text.slice(0, 200)}`), { status: res.status });
    }
    return res;
  }

  async put(key: string, value: Body, opts?: { httpMetadata?: { contentType?: string } }) {
    await this.call(this.url(key), { method: "PUT", body: await toBuffer(value), headers: { "content-type": opts?.httpMetadata?.contentType ?? "application/octet-stream" } });
    return { key };
  }
  async head(key: string) {
    const res = await this.aws.fetch(this.url(key), { method: "HEAD" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Storage HEAD failed (${res.status})`);
    return { key, size: Number(res.headers.get("content-length") ?? 0) };
  }
  async get(key: string, opts?: { range?: { offset: number; length: number } }) {
    const headers: Record<string, string> = {};
    if (opts?.range) headers.range = `bytes=${opts.range.offset}-${opts.range.offset + opts.range.length - 1}`;
    const res = await this.aws.fetch(this.url(key), { method: "GET", headers });
    if (res.status === 404) { await res.body?.cancel(); return null; }
    if (!(res.status === 200 || res.status === 206)) throw new Error(`Storage GET failed (${res.status})`);
    return { key, size: Number(res.headers.get("content-length") ?? 0), body: res.body as ReadableStream, arrayBuffer: () => res.arrayBuffer() };
  }
  async delete(key: string) {
    const res = await this.aws.fetch(this.url(key), { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`Storage DELETE failed (${res.status})`);
  }
  async createMultipartUpload(key: string, opts?: { httpMetadata?: { contentType?: string } }) {
    const res = await this.call(this.url(key, "?uploads"), { method: "POST", headers: { "content-type": opts?.httpMetadata?.contentType ?? "application/octet-stream" } });
    const id = xmlText(await res.text(), "UploadId");
    if (!id) throw new Error("Storage did not return an upload id.");
    return this.resumeMultipartUpload(key, id);
  }
  resumeMultipartUpload(key: string, uploadId: string) {
    const q = (extra = "") => `?${extra}uploadId=${enc(uploadId)}`;
    return {
      key, uploadId,
      uploadPart: async (partNumber: number, body: Body) => {
        // Parts are <= 32 MiB: buffer so the request can be signed with a payload hash.
        const res = await this.call(this.url(key, q(`partNumber=${partNumber}&`)), { method: "PUT", body: await toBuffer(body) });
        const etag = res.headers.get("etag");
        if (!etag) throw new Error("Storage did not return a part ETag.");
        return { partNumber, etag };
      },
      abort: async () => { await this.aws.fetch(this.url(key, q()), { method: "DELETE" }); },
      complete: async (parts: { partNumber: number; etag: string }[]) => {
        const xml = `<CompleteMultipartUpload>${[...parts].sort((a, b) => a.partNumber - b.partNumber).map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</ETag></Part>`).join("")}</CompleteMultipartUpload>`;
        const res = await this.call(this.url(key, q()), { method: "POST", body: xml, headers: { "content-type": "application/xml" } });
        // S3 can answer 200 with an <Error> body.
        const text = await res.text();
        if (/<Error>/.test(text)) throw new Error("Storage could not complete the upload.");
        return { key };
      },
    };
  }
}
