import type { AppEnv } from "./env";
import { signPayload, verifyPayload } from "./crypto";
import { epochSeconds } from "./time";

/** Object keys are built from server-generated ids only — never from user-supplied filenames. */
export const keys = {
  ipa: (org: string, project: string, build: string) => `organisations/${org}/projects/${project}/builds/${build}/original/app.ipa`,
  report: (org: string, project: string, build: string, report: string) => `organisations/${org}/projects/${project}/builds/${build}/reports/${report}.json`,
  attachment: (org: string, feedback: string, id: string) => `organisations/${org}/feedback/${feedback}/attachments/${id}`,
  asset: (org: string, project: string, id: string) => `organisations/${org}/projects/${project}/assets/${id}`,
};

export type FileKind = "build" | "attachment" | "report";
export interface FileGrant {
  k: FileKind;
  id: string;
  exp: number;
  /** Optional context for audit/analytics only; never trusted for authorisation. */
  lid?: string;
  uid?: string;
  dl?: 1; // force download disposition
}

export async function signedFileUrl(env: AppEnv, g: Omit<FileGrant, "exp">, ttlSec = 600): Promise<string> {
  const token = await signPayload(env.URL_SIGNING_SECRET, { ...g, exp: epochSeconds() + ttlSec });
  return `${env.APP_URL}/api/v1/files/${token}`;
}
export const verifyFileGrant = (env: AppEnv, token: string) => verifyPayload<FileGrant>(env.URL_SIGNING_SECRET, token);

/** Short-lived grant for the customer page (manifest/download without cookies, e.g. iOS itms-services fetch). */
export interface AccessGrant { lid: string; uid?: string | null; exp: number }
export const signAccessGrant = (env: AppEnv, g: Omit<AccessGrant, "exp">, ttlSec = 900) =>
  signPayload(env.URL_SIGNING_SECRET, { ...g, exp: epochSeconds() + ttlSec });
export const verifyAccessGrant = (env: AppEnv, t: string) => verifyPayload<AccessGrant>(env.URL_SIGNING_SECRET, t);

/** Stream an R2 object through DigestStream (when the runtime offers it) to compute SHA-256 without buffering. */
export async function sha256OfObject(env: AppEnv, key: string): Promise<string | null> {
  const DS = (globalThis.crypto as unknown as { DigestStream?: new (alg: string) => WritableStream & { digest: Promise<ArrayBuffer> } }).DigestStream;
  const obj = await env.BUCKET.get(key);
  if (!obj) return null;
  if (DS) {
    const ds = new DS("SHA-256");
    await obj.body.pipeTo(ds);
    return Array.from(new Uint8Array(await ds.digest), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Fallback (tests / Node): buffer the object. Only used for small objects.
  const buf = await obj.arrayBuffer();
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- Content sniffing -------------------------------------------------
export function sniffImageType(b: Uint8Array): string | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && String.fromCharCode(...b.slice(0, 4)) === "GIF8") return "image/gif";
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  if (b.length >= 12 && String.fromCharCode(...b.slice(4, 8)) === "ftyp" && /^(heic|heix|mif1|msf1|hevc)/.test(String.fromCharCode(...b.slice(8, 12)))) return "image/heic";
  return null;
}
export const isZip = (b: Uint8Array) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) ;

/** Headers for serving private objects: never inline-render active content, never cache shared. */
export function downloadHeaders(filename: string, contentType: string, size?: number, inlineImage = false): Headers {
  const h = new Headers();
  const safe = filename.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";
  h.set("content-type", contentType);
  h.set("content-disposition", `${inlineImage ? "inline" : "attachment"}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`);
  h.set("x-content-type-options", "nosniff");
  h.set("cache-control", "private, no-store");
  h.set("content-security-policy", "default-src 'none'; sandbox");
  if (size != null) h.set("content-length", String(size));
  return h;
}
