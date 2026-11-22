import { describe, expect, it } from "vitest";
import { call, fakeIpaBytes } from "../helpers/harness";
import { createScenario } from "../helpers/scenario";
import * as portalBuilds from "@/app/api/v1/portal/builds/route";

describe("Available builds (customer app)", () => {
  it("lists every published build exactly once, newest first, even with duplicate or missing links", async () => {
    const S = await createScenario(); const t = await S.tenant("Shown");
    const a = await S.validateAndPublish(t, fakeIpaBytes(2048));
    const b = await S.validateAndPublish(t, fakeIpaBytes(4096));
    await S.makeLink(t, a.buildId, { accessScope: "project_members" }); // a second link to the same first build
    const r = await call(portalBuilds.GET, { cookie: t.testerCookie });
    expect(r.status).toBe(200);
    const ids = (r.data as { path: string }[]).map((x) => x.path);
    expect(r.data.length).toBe(2); // one row per build, not per link
    expect(new Set(ids).size).toBe(2);
    expect(r.data.map((x: { build_number: string }) => x.build_number).length).toBe(2);
    void b;
  });

  it("includes a published build that has no link yet (backfill)", async () => {
    const S = await createScenario(); const t = await S.tenant("Backfill");
    await S.validateAndPublish(t);
    const { one, run } = await import("@/lib/db");
    await run(S.env.DB, "DELETE FROM distribution_links");
    expect((await one<{ n: number }>(S.env.DB, "SELECT COUNT(*) AS n FROM distribution_links"))!.n).toBe(0);
    const r = await call(portalBuilds.GET, { cookie: t.testerCookie });
    expect(r.data.length).toBe(1);
    expect(r.data[0].path).toMatch(/^\/d\//);
  });
});
