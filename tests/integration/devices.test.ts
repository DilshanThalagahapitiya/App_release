import { beforeEach, describe, expect, it } from "vitest";
import { call } from "../helpers/harness";
import { createScenario } from "../helpers/scenario";
import { one, run } from "@/lib/db";
import { appleDeviceList, parseDeviceReport } from "@/services/devices";
import * as devices from "@/app/api/v1/projects/[projectId]/devices/route";
import * as revoke from "@/app/api/v1/device-requests/[requestId]/revoke/route";
import * as profile from "@/app/u/[token]/profile.mobileconfig/route";
import * as callback from "@/app/u/[token]/callback/route";

let S: Awaited<ReturnType<typeof createScenario>>;
beforeEach(async () => { S = await createScenario(); });

/** Mimics what iOS posts: a binary CMS wrapper around a plain XML plist. TEST FIXTURE. */
const iosReport = (udid: string, extra = "") => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>UDID</key><string>${udid}</string><key>PRODUCT</key><string>iPhone15,2</string><key>VERSION</key><string>22B91</string><key>DEVICE_NAME</key><string>Mr Silva's iPhone</string>${extra}</dict></plist>`;
  const head = new Uint8Array([0x30, 0x82, 0x0a, 0x1b, 0x06, 0x09, 0xff, 0x00]);
  const body = new TextEncoder().encode(xml);
  const tail = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0x80]);
  const out = new Uint8Array(head.length + body.length + tail.length); out.set(head); out.set(body, head.length); out.set(tail, head.length + body.length);
  return out;
};
const UDID = "00008110-001A2B3C4D5E801E";

describe("device (UDID) collection", () => {
  it("creates a link, serves the profile, records the device from iOS's callback, and dedupes", async () => {
    const a = await S.tenant("Alpha");
    const r = await call(devices.POST, { cookie: a.adminCookie, params: { projectId: a.projectId }, body: { label: "Mr Silva" } });
    expect(r.status).toBe(201);
    const token = r.data.url.split("/u/")[1];
    const row = await one<{ token_hash: string }>(S.env.DB, "SELECT token_hash FROM device_requests WHERE id = ?", r.data.id);
    expect(row!.token_hash).not.toContain(token);

    const p = await call(profile.GET, { params: { token }, origin: null });
    expect(p.status).toBe(200);
    expect(p.headers.get("content-type")).toContain("application/x-apple-aspen-config");
    expect(p.text).toContain("<string>Profile Service</string>");
    expect(p.text).toContain(`https://portal.test/u/${token}/callback`);
    expect(p.text).not.toContain("<key>PayloadCertificateFileName");

    // iOS callback: no cookies, no Origin. Must answer 301 to finish enrolment.
    const post = () => callback.POST(new Request(`https://portal.test/u/${token}/callback`, { method: "POST", body: iosReport(UDID) as unknown as BodyInit, headers: { "content-length": String(iosReport(UDID).length) } }), { params: Promise.resolve({ token }) });
    const res = await post();
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`https://portal.test/u/${token}/done`);
    expect((await post()).status).toBe(301); // second submit is harmless
    const list = await call(devices.GET, { cookie: a.adminCookie, params: { projectId: a.projectId } });
    expect(list.data.devices).toHaveLength(1);
    expect(list.data.devices[0]).toMatchObject({ udid: UDID, product: "iPhone15,2", label: "Mr Silva" });
    expect(list.data.requests[0].collected).toBe(1);
    const n = await one<{ n: number }>(S.env.DB, "SELECT COUNT(*) AS n FROM notifications WHERE type = 'device_submitted'");
    expect(n!.n).toBeGreaterThan(0);

    const txt = await call(devices.GET, { cookie: a.adminCookie, params: { projectId: a.projectId }, query: { format: "txt" } });
    expect(txt.text).toBe(`Device ID\tDevice Name\tPlatform\n${UDID}\tMr Silva\tios\n`);
  });

  it("rejects garbage, revoked and expired requests; other tenants cannot see devices", async () => {
    const a = await S.tenant("Alpha"); const b = await S.tenant("Bravo");
    const r = await call(devices.POST, { cookie: a.adminCookie, params: { projectId: a.projectId }, body: { label: "X" } });
    const token = r.data.url.split("/u/")[1];
    const send = (bytes: Uint8Array, t = token) => callback.POST(new Request(`https://portal.test/u/${t}/callback`, { method: "POST", body: bytes as unknown as BodyInit, headers: { "content-length": String(bytes.length) } }), { params: Promise.resolve({ token: t }) });
    expect((await send(new TextEncoder().encode("hello"))).status).toBe(422);
    expect((await send(iosReport("NOT-A-UDID"))).status).toBe(422);
    expect((await send(iosReport(UDID), "A".repeat(43))).status).toBe(410);
    expect((await call(devices.GET, { cookie: b.adminCookie, params: { projectId: a.projectId } })).status).toBe(404);
    expect((await call(devices.GET, { cookie: a.testerCookie, params: { projectId: a.projectId } })).status).toBe(403);
    expect((await call(devices.POST, { cookie: a.testerCookie, params: { projectId: a.projectId }, body: { label: "no" } })).status).toBe(403);
    await run(S.env.DB, "UPDATE device_requests SET expires_at = ? WHERE id = ?", new Date(Date.now() - 1000).toISOString(), r.data.id);
    expect((await send(iosReport(UDID))).status).toBe(410);
    await run(S.env.DB, "UPDATE device_requests SET expires_at = ? WHERE id = ?", new Date(Date.now() + 99999).toISOString(), r.data.id);
    expect((await call(revoke.POST, { cookie: b.adminCookie, params: { requestId: r.data.id } })).status).toBe(404);
    expect((await call(revoke.POST, { cookie: a.adminCookie, params: { requestId: r.data.id } })).status).toBe(200);
    expect((await send(iosReport(UDID))).status).toBe(410);
    expect((await call(profile.GET, { params: { token }, origin: null })).status).toBe(410);
  });

  it("parses reports and formats Apple's bulk-upload list", () => {
    expect(parseDeviceReport(iosReport(UDID))).toMatchObject({ UDID, PRODUCT: "iPhone15,2" });
    expect(parseDeviceReport(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(appleDeviceList([{ udid: "U", device_name: null, label: "a\tb\nc", product: null }])).toBe("Device ID\tDevice Name\tPlatform\nU\ta b c\tios\n");
  });
});
