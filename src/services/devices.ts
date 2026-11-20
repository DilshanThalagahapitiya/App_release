import type { AppEnv } from "@/lib/env";
import type { Actor } from "@/lib/auth";
import { all, one, run } from "@/lib/db";
import { ApiError, notFound } from "@/lib/errors";
import { hashToken, newId } from "@/lib/crypto";
import { addDays, nowIso } from "@/lib/time";
import { xmlEscape } from "@/lib/rules";
import { audit } from "@/lib/audit";
import { loadProject } from "@/lib/access";
import { notify, projectStaffIds } from "@/lib/notify";
import { derivePublicToken } from "./distribution";

/**
 * Device-ID collection with Apple's Profile Service ("enrollment" profile). The client installs a tiny
 * configuration profile; iOS then POSTs the device's UDID/model/OS to our callback. Nothing else is read
 * from the phone, and the profile installs no settings or apps.
 */
const UDID_RE = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{16}$|^[0-9A-Fa-f]{40}$/;

export const requestToken = (env: AppEnv, id: string) => derivePublicToken(env, "device-request:" + id);

export async function createRequest(env: AppEnv, actor: Actor, projectId: string, input: { label: string; expiresInDays: number }, req?: Request) {
  const { project } = await loadProject(env, actor, projectId, "distribution:manage");
  const id = newId();
  const token = await requestToken(env, id);
  await run(env.DB, "INSERT INTO device_requests (id, organisation_id, project_id, created_by, token_hash, label, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?)",
    id, project.organisation_id, projectId, actor.userId, await hashToken(token), input.label, addDays(input.expiresInDays), nowIso());
  await audit(env, { organisationId: project.organisation_id, actorUserId: actor.userId, action: "device_request.created", resourceType: "device_request", resourceId: id, metadata: { label: input.label }, req });
  return { id, label: input.label, url: `${env.APP_URL}/u/${token}`, expiresAt: addDays(input.expiresInDays) };
}

export async function listDevices(env: AppEnv, actor: Actor, projectId: string) {
  await loadProject(env, actor, projectId, "distribution:manage");
  const requests = await all<{ id: string; label: string; expires_at: string; status: string; created_at: string; collected: number }>(env.DB,
    `SELECT r.id, r.label, r.expires_at, r.status, r.created_at, (SELECT COUNT(*) FROM devices d WHERE d.request_id = r.id) AS collected
       FROM device_requests r WHERE r.project_id = ? ORDER BY r.created_at DESC`, projectId);
  const withUrls = await Promise.all(requests.map(async (r) => ({ ...r, expired: r.expires_at < nowIso(), url: r.status === "active" ? `${env.APP_URL}/u/${await requestToken(env, r.id)}` : null })));
  const devices = await all(env.DB, "SELECT id, udid, product, os_version, device_name, label, created_at FROM devices WHERE project_id = ? ORDER BY created_at DESC", projectId);
  return { requests: withUrls, devices };
}

export async function revokeRequest(env: AppEnv, actor: Actor, requestId: string, req?: Request) {
  const r = await one<{ id: string; project_id: string; organisation_id: string }>(env.DB, "SELECT id, project_id, organisation_id FROM device_requests WHERE id = ?", requestId);
  if (!r) throw notFound("Request");
  await loadProject(env, actor, r.project_id, "distribution:manage");
  await run(env.DB, "UPDATE device_requests SET status = 'revoked', revoked_at = ? WHERE id = ?", nowIso(), requestId);
  await audit(env, { organisationId: r.organisation_id, actorUserId: actor.userId, action: "device_request.revoked", resourceType: "device_request", resourceId: requestId, req });
  return { id: requestId, revoked: true };
}

export async function deleteDevice(env: AppEnv, actor: Actor, deviceId: string, req?: Request) {
  const d = await one<{ project_id: string; organisation_id: string }>(env.DB, "SELECT project_id, organisation_id FROM devices WHERE id = ?", deviceId);
  if (!d) throw notFound("Device");
  await loadProject(env, actor, d.project_id, "distribution:manage");
  await run(env.DB, "DELETE FROM devices WHERE id = ?", deviceId);
  await audit(env, { organisationId: d.organisation_id, actorUserId: actor.userId, action: "device.deleted", resourceType: "device", resourceId: deviceId, req });
  return { id: deviceId, deleted: true };
}

/** Tab-separated text in the exact format Apple's "Register Multiple Devices" upload accepts. */
export function appleDeviceList(devices: { udid: string; device_name: string | null; label: string | null; product: string | null }[]): string {
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ").trim();
  return ["Device ID\tDevice Name\tPlatform", ...devices.map((d) => `${d.udid}\t${clean(d.label ?? d.device_name ?? d.product ?? "iPhone")}\tios`)].join("\n") + "\n";
}

// ------------------------------------------------------------ public side

export interface PublicRequest { id: string; organisation_id: string; project_id: string; label: string; org_name: string; project_name: string }
export async function resolveRequest(env: AppEnv, token: string): Promise<PublicRequest | null> {
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(token)) return null;
  return one<PublicRequest>(env.DB,
    `SELECT r.id, r.organisation_id, r.project_id, r.label, o.name AS org_name, p.name AS project_name
       FROM device_requests r JOIN organisations o ON o.id = r.organisation_id JOIN projects p ON p.id = r.project_id
      WHERE r.token_hash = ? AND r.status = 'active' AND r.expires_at > ? AND o.status = 'active'`, await hashToken(token), nowIso());
}

export function enrollmentProfile(env: AppEnv, token: string, r: PublicRequest): string {
  const uuid = (s: string) => crypto.randomUUID().toUpperCase() + s.slice(0, 0);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <dict>
    <key>URL</key><string>${xmlEscape(`${env.APP_URL}/u/${token}/callback`)}</string>
    <key>DeviceAttributes</key>
    <array><string>UDID</string><string>PRODUCT</string><string>VERSION</string><string>DEVICE_NAME</string></array>
  </dict>
  <key>PayloadOrganization</key><string>${xmlEscape(r.org_name)}</string>
  <key>PayloadDisplayName</key><string>Share my device ID with ${xmlEscape(r.org_name)}</string>
  <key>PayloadDescription</key><string>Sends only your device ID, model and iOS version so ${xmlEscape(r.org_name)} can prepare the test app for your iPhone. It installs nothing else.</string>
  <key>PayloadVersion</key><integer>1</integer>
  <key>PayloadUUID</key><string>${uuid("")}</string>
  <key>PayloadIdentifier</key><string>app.release-portal.device-id.${xmlEscape(r.id.slice(0, 8))}</string>
  <key>PayloadType</key><string>Profile Service</string>
</dict>
</plist>
`;
}

/** iOS posts a CMS-signed blob whose payload is a plain XML plist; pull the plist out and read string keys. */
export function parseDeviceReport(body: Uint8Array): Record<string, string> | null {
  const text = new TextDecoder("latin1").decode(body);
  const start = text.indexOf("<?xml");
  const end = text.indexOf("</plist>");
  if (start < 0 || end < 0 || end < start) return null;
  const xml = text.slice(start, end + 8);
  const out: Record<string, string> = {};
  for (const m of xml.matchAll(/<key>([A-Z_]{2,20})<\/key>\s*<string>([^<]{0,200})<\/string>/g)) out[m[1]] = m[2].trim();
  return out;
}

export async function recordDevice(env: AppEnv, req: Request, token: string, body: Uint8Array) {
  const r = await resolveRequest(env, token);
  if (!r) throw new ApiError("LINK_UNAVAILABLE", "This request link is no longer active.");
  const info = parseDeviceReport(body);
  const udid = info?.UDID?.toUpperCase();
  if (!info || !udid || !UDID_RE.test(udid)) throw new ApiError("VALIDATION_ERROR", "The device report was not understood.");
  const fresh = await one(env.DB, `INSERT INTO devices (id, organisation_id, project_id, request_id, udid, product, os_version, device_name, label, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id, udid) DO NOTHING RETURNING id`,
    newId(), r.organisation_id, r.project_id, r.id, udid, (info.PRODUCT ?? "").slice(0, 40) || null, (info.VERSION ?? "").slice(0, 40) || null, (info.DEVICE_NAME ?? "").slice(0, 80) || null, r.label, nowIso());
  await audit(env, { organisationId: r.organisation_id, actorType: "anonymous", action: "device.collected", resourceType: "device_request", resourceId: r.id, metadata: { duplicate: !fresh }, req });
  if (fresh) {
    await notify(env, { userIds: await projectStaffIds(env, r.project_id, r.organisation_id), organisationId: r.organisation_id, type: "device_submitted", title: `Device ID received from ${r.label}`, body: `${info.PRODUCT ?? "iPhone"} · open the project's Devices tab to copy it.`, resourceType: "project", resourceId: r.project_id, path: `/app/projects/${r.project_id}/devices` });
  }
  return { isNew: !!fresh, token };
}
