import { api } from "@/lib/http";
import { loadBuild } from "@/lib/access";
import { signedFileUrl } from "@/lib/storage";
export const POST = api(async (c) => {
  const { build } = await loadBuild(c.env, c.user(), c.params.buildId, "build:view_internal");
  return { url: await signedFileUrl(c.env, { k: "report", id: build.id, uid: c.user().userId, dl: 1 }, 300) };
});
