import { api } from "@/lib/http";
import { loadBuild } from "@/lib/access";
import { signedFileUrl } from "@/lib/storage";
import { audit } from "@/lib/audit";
// Authorised admins only: returns a short-lived signed URL for the ORIGINAL IPA. The R2 key is never exposed.
export const POST = api(async (c) => {
  const actor = c.user();
  const { build } = await loadBuild(c.env, actor, c.params.buildId, "build:download_ipa");
  await audit(c.env, { organisationId: build.organisation_id, actorUserId: actor.userId, action: "build.ipa_downloaded", resourceType: "build", resourceId: build.id, req: c.req });
  return { url: await signedFileUrl(c.env, { k: "build", id: build.id, uid: actor.userId, dl: 1 }, 300), expiresInSeconds: 300 };
});
