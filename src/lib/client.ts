"use client";
// Browser-side API helper. Session auth is an HttpOnly cookie; nothing secret is kept in JS or localStorage.
export class ClientApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

export async function apiFetch<T = unknown>(path: string, init: { method?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  let body: BodyInit | undefined = init.raw;
  if (init.body !== undefined) { body = JSON.stringify(init.body); headers["content-type"] = "application/json"; }
  const res = await fetch(`/api/v1${path}`, { method: init.method ?? (body !== undefined ? "POST" : "GET"), headers, body, signal: init.signal, credentials: "same-origin" });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: { data?: T; error?: { code: string; message: string; details?: unknown } } = {};
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !location.pathname.startsWith("/auth") && !location.pathname.startsWith("/d/")) location.href = "/auth/login?expired=1";
    throw new ClientApiError(res.status, json.error?.code ?? "ERROR", json.error?.message ?? `Request failed (${res.status})`, json.error?.details);
  }
  return json.data as T;
}

export { fmtBytes, fmtDate, fmtDay, ago, label } from "./format";
