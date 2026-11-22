import { describe, expect, it } from "vitest";
import { call } from "../helpers/harness";
import { createScenario } from "../helpers/scenario";
import * as prefs from "@/app/api/v1/notifications/preferences/route";

describe("notification preferences are for owners and admins only", () => {
  it("rejects testers, allows org admins and the platform owner", async () => {
    const S = await createScenario(); const t = await S.tenant("Prefs");
    const body = { eventType: "build_published", inApp: false, email: false };
    const tester = await call(prefs.PUT, { cookie: t.testerCookie, method: "PUT", body });
    expect(tester.status).toBe(403);
    expect((await call(prefs.PUT, { cookie: t.adminCookie, method: "PUT", body })).status).toBe(200);
    expect((await call(prefs.PUT, { cookie: S.ownerCookie, method: "PUT", body })).status).toBe(200);
    const saved = await call(prefs.GET, { cookie: t.adminCookie });
    expect(saved.data.find((p: { event_type: string }) => p.event_type === "build_published").in_app_enabled).toBe(0);
  });
});
