import { api } from "@/lib/http";
import { ApiError } from "@/lib/errors";
import { consumeDownload, installAction, logEvent, resolveLink } from "@/services/distribution";
import { signedFileUrl } from "@/lib/storage";
export const GET = api(async (c) => {
  const r = await resolveLink(c.env, c.req, c.params.token, { grant: c.url.searchParams.get("a") });
  if (r.access !== "granted") throw new ApiError(r.state !== "active" ? "LINK_UNAVAILABLE" : "FORBIDDEN", "Access to this download has not been granted.");
  const action = await installAction(c.env, r);
  if (action.kind !== "download" && action.kind !== "ota") throw new ApiError("FORBIDDEN", action.reason);
  if (action.kind === "ota") throw new ApiError("FORBIDDEN", "Use the Install button; direct IPA download is not enabled for this build.");
  if (!r.staffPreview) await consumeDownload(c.env, r);
  await logEvent(c.env, r, c.req, "download_started");
  const url = await signedFileUrl(c.env, { k: "build", id: r.build.id, lid: r.link.id, uid: r.user?.userId, dl: 1 }, 300);
  return new Response(null, { status: 302, headers: { location: url, "cache-control": "private, no-store" } });
}, { auth: "public", rate: ["download", 60, 600] });
