import type { AppEnv } from "./env";

/**
 * Minimal Appetize.io REST client (v1). Runs only on the server: the API token never reaches the browser and is
 * never logged or put in an error message. https://docs.appetize.io/rest-api
 */
export class AppetizeError extends Error {
  constructor(public code: "NOT_CONFIGURED" | "AUTH" | "BAD_REQUEST" | "NOT_FOUND" | "RATE_LIMITED" | "SERVER" | "NETWORK" | "BAD_RESPONSE", message: string, public retryable: boolean, public status?: number) { super(message); }
}

export const appetizeConfigured = (env: AppEnv) => !!env.APPETIZE_API_TOKEN;
const base = (env: AppEnv) => (env.APPETIZE_API_BASE ?? "https://api.appetize.io").replace(/\/+$/, "");
const TIMEOUT_MS = 110_000;

async function call(env: AppEnv, method: "POST" | "DELETE", path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!env.APPETIZE_API_TOKEN) throw new AppetizeError("NOT_CONFIGURED", "Appetize is not configured: the APPETIZE_API_TOKEN secret has not been set on the server.", false);
  let res: Response;
  try {
    res = await fetch(`${base(env)}${path}`, {
      method, headers: { "X-API-KEY": env.APPETIZE_API_TOKEN, ...(body ? { "content-type": "application/json" } : {}), accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const timeout = (e as Error).name === "TimeoutError" || (e as Error).name === "AbortError";
    throw new AppetizeError("NETWORK", timeout ? "Appetize did not answer in time." : "Could not reach Appetize.", true);
  }
  const text = await res.text().catch(() => "");
  let json: Record<string, unknown> = {};
  try { json = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { /* non-JSON body */ }
  if (res.ok) return json;
  const detail = typeof json.message === "string" ? ` (${json.message.slice(0, 300)})` : "";
  if (res.status === 401 || res.status === 403) throw new AppetizeError("AUTH", "Appetize rejected the API token. Check APPETIZE_API_TOKEN and that the token's role can create apps.", false, res.status);
  if (res.status === 404) throw new AppetizeError("NOT_FOUND", `Appetize could not find that app${detail}.`, false, 404);
  if (res.status === 429) throw new AppetizeError("RATE_LIMITED", "Appetize is rate limiting requests.", true, 429);
  if (res.status >= 500) throw new AppetizeError("SERVER", `Appetize had a problem (HTTP ${res.status}).`, true, res.status);
  throw new AppetizeError("BAD_REQUEST", `Appetize refused the build${detail || ` (HTTP ${res.status})`}.`, false, res.status);
}

export interface AppetizeApp { publicKey: string; versionCode: number | null }
function parseApp(j: Record<string, unknown>): AppetizeApp {
  if (typeof j.publicKey !== "string" || !j.publicKey) throw new AppetizeError("BAD_RESPONSE", "Appetize answered without a public key.", true);
  return { publicKey: j.publicKey, versionCode: typeof j.versionCode === "number" ? j.versionCode : null };
}

export interface AppetizeUpload { url: string; fileType: "zip" | "tar.gz"; note?: string; embedHostname?: string }
function uploadBody(u: AppetizeUpload) {
  return {
    platform: "ios", url: u.url, fileType: u.fileType, ...(u.note ? { note: u.note.slice(0, 200) } : {}),
    // Only our portal may embed the app, and anyone who reaches the portal page may run it (portal access is checked by us).
    ...(u.embedHostname ? { referrerHostnamesRestricted: [u.embedHostname] } : {}),
    appPermissions: { run: "public" }, disabled: false,
  };
}
/** Create a brand-new Appetize app from a build that Appetize downloads from `url` (publicly reachable https). */
export const createApp = async (env: AppEnv, u: AppetizeUpload) => parseApp(await call(env, "POST", "/v1/apps", uploadBody(u)));
/** Upload a newer build into an existing Appetize app (same public key). */
export const updateApp = async (env: AppEnv, publicKey: string, u: AppetizeUpload) => parseApp(await call(env, "POST", `/v1/apps/${encodeURIComponent(publicKey)}`, uploadBody(u)));
export async function setAppDisabled(env: AppEnv, publicKey: string, disabled: boolean) { await call(env, "POST", `/v1/apps/${encodeURIComponent(publicKey)}`, { platform: "ios", disabled }); }
export async function deleteApp(env: AppEnv, publicKey: string) { await call(env, "DELETE", `/v1/apps/${encodeURIComponent(publicKey)}`); }

export const IOS_DEVICES = ["iphone15pro", "iphone15promax", "iphone16pro", "iphone16promax", "iphone17pro", "iphone17promax", "iphone14pro", "iphone14promax", "iphone13pro", "iphone13promax", "iphone12", "iphone11pro", "ipadair4thgeneration", "ipadpro129inch5thgeneration", "ipad9thgeneration", "ipadmini6thgeneration"] as const;
export const embedUrl = (publicKey: string, device: string, osVersion?: string | null) =>
  `https://appetize.io/embed/${encodeURIComponent(publicKey)}?device=${encodeURIComponent(device)}${osVersion ? `&osVersion=${encodeURIComponent(osVersion)}` : ""}&scale=auto&centered=both&autoplay=false&orientation=portrait&deviceColor=black`;
/** Appetize's hosted player (works without the embed feature of the plan). */
export const hostedUrl = (publicKey: string, device: string, osVersion?: string | null) =>
  `https://appetize.io/app/${encodeURIComponent(publicKey)}?device=${encodeURIComponent(device)}${osVersion ? `&osVersion=${encodeURIComponent(osVersion)}` : ""}`;

/** iOS major versions Appetize offers per simulator device (https://docs.appetize.io/features/devices-and-os-versions). */
const OS_ALL = [17, 18, 26, 27];
export const DEVICE_OS: Record<string, number[]> = {
  iphone11pro: OS_ALL, iphone12: OS_ALL, iphone13pro: OS_ALL, iphone13promax: OS_ALL, iphone14pro: OS_ALL, iphone14promax: OS_ALL, iphone15pro: OS_ALL, iphone15promax: OS_ALL,
  iphone16pro: [18, 26, 27], iphone16promax: [18, 26, 27], iphone17pro: [26, 27], iphone17promax: [26, 27],
  ipadair4thgeneration: OS_ALL, ipadpro129inch5thgeneration: OS_ALL, ipad9thgeneration: OS_ALL, ipadmini6thgeneration: [18, 26, 27],
};
export const osVersionsFor = (device: string): number[] => DEVICE_OS[device] ?? OS_ALL;

/**
 * The simulator iOS version for an app: the OLDEST version Appetize offers on this device that is at least the app's
 * minimum iOS (so the app runs on the version it claims to support). Unknown minimum -> null (Appetize's default, the latest).
 */
export function pickOsVersion(device: string, minimumOS: string | null | undefined): string | null {
  const major = minimumOS ? parseInt(minimumOS, 10) : NaN;
  if (!Number.isFinite(major)) return null;
  const list = osVersionsFor(device);
  return String(list.find((v) => v >= major) ?? list[list.length - 1]);
}
