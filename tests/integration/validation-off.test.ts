import { describe, expect, it } from "vitest";
import { call, sha256OfBytes } from "../helpers/harness";
import { createScenario, ipa } from "../helpers/scenario";
import * as usess from "@/app/api/v1/projects/[projectId]/upload-sessions/route";
import * as upart from "@/app/api/v1/upload-sessions/[sessionId]/parts/[partNumber]/route";
import * as ucomplete from "@/app/api/v1/upload-sessions/[sessionId]/complete/route";
import * as pbuilds from "@/app/api/v1/projects/[projectId]/builds/route";
import * as settings from "@/app/api/v1/settings/route";
import * as publish from "@/app/api/v1/builds/[buildId]/publish/route";
import * as build from "@/app/api/v1/builds/[buildId]/route";
import { one } from "@/lib/db";
import { resolveLink, publicView } from "@/services/distribution";

describe("validation mode OFF", () => {
  it("accepts an upload without a worker and keeps publish/link/install working", async () => {
    const S = await createScenario();
    const t = await S.tenant("Acme");
    expect((await call(settings.PUT, { cookie: S.ownerCookie, body: { validationMode: "off" } })).status).toBe(200);

    const { buildId } = await S.uploadBuild(t);
    const b = await call(build.GET, { cookie: t.adminCookie, params: { buildId } });
    expect(b.data.validation_status).toBe("completed");
    expect(b.data.eligibility_status).toBe("eligible_with_warnings");
    expect(b.data.bundle_identifier).toBe("com.example.mock");
    expect(b.data.validation.warnings[0]).toContain("Validation is OFF");
    expect(b.data.validation.signing.verification).toBe("not_performed");
    expect(await S.claimJob()).toBeNull(); // no job is waiting for a Mac

    expect((await call(publish.POST, { cookie: t.adminCookie, params: { buildId } })).status).toBe(200);
    const l = await S.makeLink(t, buildId);
    expect(l.status).toBe(201);
    const token = l.data.url.split("/d/")[1];
    const r = await resolveLink(S.env, new Request("https://portal.test/d/x", { headers: { cookie: t.testerCookie } }), token);
    expect((await publicView(S.env, r)).action.kind).toBe("ota");
  });

  it("requires the project's expected bundle identifier when validation is off", async () => {
    const S = await createScenario();
    const t = await S.tenant("Beta");
    await call(settings.PUT, { cookie: S.ownerCookie, body: { validationMode: "off" } });
    await one(S.env.DB, "UPDATE projects SET expected_bundle_identifier = NULL WHERE id = ? RETURNING id", t.projectId);
    const sha = await sha256OfBytes(ipa);
    const sess = await call(usess.POST, { cookie: t.adminCookie, params: { projectId: t.projectId }, body: { filename: "A.ipa", sizeBytes: ipa.length, sha256: sha } });
    await call(upart.PUT, { cookie: t.adminCookie, params: { sessionId: sess.data.id, partNumber: "1" }, method: "PUT", rawBody: ipa as unknown as BodyInit, headers: { "content-length": String(ipa.length) } });
    await call(ucomplete.POST, { cookie: t.adminCookie, params: { sessionId: sess.data.id } });
    const r = await call(pbuilds.POST, { cookie: t.adminCookie, params: { projectId: t.projectId }, body: { uploadSessionId: sess.data.id, distributionMethod: "determine_from_ipa" } });
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.data ?? r.json ?? r.text)).toContain("bundle identifier");
  });

  it("is ON by default: uploads wait for the worker", async () => {
    const S = await createScenario();
    const t = await S.tenant("Gamma");
    const { buildId } = await S.uploadBuild(t);
    const b = await call(build.GET, { cookie: t.adminCookie, params: { buildId } });
    expect(b.data.validation_status).toBe("pending");
    expect(await S.claimJob()).not.toBeNull();
  });
});
