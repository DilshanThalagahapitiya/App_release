import { api } from "@/lib/http";
import { ApiError } from "@/lib/errors";
import { resolveLink } from "@/services/distribution";
import { getInstallProgress } from "@/services/install-progress";

// Polled by the install page after the person taps Install. Access is the same short-lived signed grant used for the manifest.
export const GET = api(async (c) => {
  const r = await resolveLink(c.env, c.req, c.params.token, { grant: c.url.searchParams.get("a") });
  if (r.access !== "granted") throw new ApiError("FORBIDDEN", "Access has not been granted.");
  const since = c.url.searchParams.get("since");
  const sinceIso = since && !isNaN(Date.parse(since)) ? new Date(since).toISOString() : new Date(Date.now() - 600000).toISOString();
  return getInstallProgress(c.env, c.req, r.link.id, sinceIso);
}, { auth: "public", rate: ["install-status", 600, 600] });
