import { describe, expect, it } from "vitest";
import { call } from "../helpers/harness";
import { createScenario } from "../helpers/scenario";
import * as publicManifest from "@/app/d/[token]/manifest.plist/route";
import * as status from "@/app/d/[token]/install-status/route";
import * as files from "@/app/api/v1/files/[token]/route";
import { signAccessGrant, signedFileUrl } from "@/lib/storage";

describe("install progress", () => {
  it("follows manifest -> downloading -> downloaded as iOS fetches the build", async () => {
    const S = await createScenario(); const t = await S.tenant("Prog");
    const { buildId } = await S.validateAndPublish(t);
    const l = await S.makeLink(t, buildId);
    const token = l.data.url.split("/d/")[1];
    const grant = await signAccessGrant(S.env, { lid: l.data.id, uid: t.testerId });
    const since = new Date(Date.now() - 5000).toISOString();
    const poll = () => call(status.GET, { params: { token }, query: { a: grant, since }, origin: null });

    expect((await poll()).data.stage).toBe("waiting");
    expect((await call(publicManifest.GET, { params: { token }, query: { a: grant }, origin: null })).status).toBe(200);
    expect((await poll()).data.stage).toBe("manifest");

    const fileUrl = await signedFileUrl(S.env, { k: "build", id: buildId, lid: l.data.id, uid: t.testerId }, 600);
    const dl = await call(files.GET, { params: { token: fileUrl.split("/files/")[1] }, origin: null });
    expect(dl.status).toBe(200);
    const after = (await poll()).data;
    expect(after.stage).toBe("downloaded");
    expect(after.percent).toBe(100);
  });

  it("refuses status requests without a valid grant", async () => {
    const S = await createScenario(); const t = await S.tenant("Prog2");
    const { buildId } = await S.validateAndPublish(t);
    const l = await S.makeLink(t, buildId);
    const r = await call(status.GET, { params: { token: l.data.url.split("/d/")[1] }, query: { a: "bogus" }, origin: null });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});
