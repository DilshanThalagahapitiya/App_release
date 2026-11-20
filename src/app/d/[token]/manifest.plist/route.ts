import { api } from "@/lib/http";
import { ApiError } from "@/lib/errors";
import { consumeDownload, logEvent, manifestFor, resolveLink } from "@/services/distribution";
// iOS fetches this without cookies, so access is carried by the short-lived signed `a` grant created when the page rendered.
export const GET = api(async (c) => {
  const r = await resolveLink(c.env, c.req, c.params.token, { grant: c.url.searchParams.get("a") });
  if (r.access !== "granted") throw new ApiError(r.state !== "active" ? "LINK_UNAVAILABLE" : "FORBIDDEN", "Access to this manifest has not been granted.");
  const xml = await manifestFor(c.env, r);
  if (!r.staffPreview) await consumeDownload(c.env, r);
  await logEvent(c.env, r, c.req, "manifest_requested");
  return new Response(xml, { headers: { "content-type": "text/xml; charset=utf-8", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}, { auth: "public", rate: ["manifest", 120, 600] });
