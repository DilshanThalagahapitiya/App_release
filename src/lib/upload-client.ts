"use client";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { apiFetch } from "./client";

export interface UploadState { phase: "idle" | "hashing" | "uploading" | "completing" | "done" | "error" | "cancelled"; percent: number; message: string; sessionId?: string }

/** Streaming SHA-256 in 8 MiB slices so multi-GB IPAs never need to fit in memory. */
export async function hashFile(file: File, onProgress: (p: number) => void, signal: AbortSignal): Promise<string> {
  const h = sha256.create();
  const slice = 8 * 1024 * 1024;
  for (let o = 0; o < file.size; o += slice) {
    if (signal.aborted) throw new DOMException("cancelled", "AbortError");
    h.update(new Uint8Array(await file.slice(o, o + slice).arrayBuffer()));
    onProgress(Math.min(1, (o + slice) / file.size));
  }
  return bytesToHex(h.digest());
}

function putPart(url: string, body: Blob, signal: AbortSignal, onBytes: (n: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    x.upload.onprogress = (e) => onBytes(e.loaded);
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(Object.assign(new Error(parseErr(x.responseText) || `Upload failed (${x.status})`), { status: x.status })));
    x.onerror = () => reject(Object.assign(new Error("Network error during upload"), { status: 0 }));
    signal.addEventListener("abort", () => { x.abort(); reject(new DOMException("cancelled", "AbortError")); });
    x.send(body);
  });
}
const parseErr = (t: string) => { try { return JSON.parse(t).error?.message as string; } catch { return ""; } };

/** Multipart upload with per-part retry (resumable: already-uploaded parts are skipped on retry of the same session). */
export async function uploadIpa(projectId: string, file: File, signal: AbortSignal, set: (s: UploadState) => void, idempotencyKey: string, kind: "ipa" | "simulator" = "ipa"): Promise<{ sessionId: string; sha256: string }> {
  set({ phase: "hashing", percent: 0, message: "Calculating SHA-256 checksum…" });
  const digest = await hashFile(file, (p) => set({ phase: "hashing", percent: Math.round(p * 100), message: "Calculating SHA-256 checksum…" }), signal);
  const session = await apiFetch<{ id: string; partSizeBytes: number; totalParts: number; uploadedParts: number[] }>(`/projects/${projectId}/upload-sessions`, { body: { filename: file.name, sizeBytes: file.size, sha256: digest, idempotencyKey, kind }, signal });
  let doneBytes = 0;
  for (let n = 1; n <= session.totalParts; n++) {
    const start = (n - 1) * session.partSizeBytes; const end = Math.min(file.size, start + session.partSizeBytes);
    if (session.uploadedParts.includes(n)) { doneBytes += end - start; continue; }
    for (let attempt = 0; ; attempt++) {
      try {
        await putPart(`/api/v1/upload-sessions/${session.id}/parts/${n}`, file.slice(start, end), signal, (loaded) => set({ phase: "uploading", sessionId: session.id, percent: Math.round(((doneBytes + loaded) / file.size) * 100), message: `Uploading part ${n} of ${session.totalParts}` }));
        break;
      } catch (e) {
        const st = (e as { status?: number }).status;
        if ((e as Error).name === "AbortError" || (st !== undefined && st >= 400 && st < 500 && st !== 408 && st !== 429) || attempt >= 3) throw e;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
    doneBytes += end - start;
  }
  set({ phase: "completing", sessionId: session.id, percent: 100, message: "Verifying size and checksum on the server…" });
  await apiFetch(`/upload-sessions/${session.id}/complete`, { method: "POST", signal });
  return { sessionId: session.id, sha256: digest };
}
